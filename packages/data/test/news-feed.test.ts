import { describe, expect, it } from 'vitest';
import { clip, fetchFeed, parseFeed, parseFeedDate, parseSec8k, stripHtml } from '../src';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Fonte</title>
<item>
  <title>Petrobras &amp; Vale: Ibovespa sobe 2%</title>
  <link>https://www.exemplo.com.br/mercados/ibov-sobe/?utm_source=rss</link>
  <guid isPermaLink="false">abc-123</guid>
  <description><![CDATA[<p>O <b>Ibovespa</b> subiu &quot;forte&quot; hoje.</p><script>x()</script>]]></description>
  <pubDate>Mon, 26 Oct 2026 09:30:00 -0300</pubDate>
  <category>Mercados</category><category>Ações</category>
</item>
<item>
  <title>Sem link é descartado</title>
</item>
<item>
  <title>Data com fuso BRT</title>
  <link>https://exemplo.com.br/b</link>
  <pubDate>Mon, 26 Oct 2026 10:00:00 BRT</pubDate>
</item>
<item>
  <title>Data ilegível vira null</title>
  <link>https://exemplo.com.br/c</link>
  <pubDate>ontem à tarde</pubDate>
</item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom</title>
  <entry>
    <title type="html">Fed mantém juros</title>
    <link rel="self" href="https://exemplo.com/self"/>
    <link rel="alternate" type="text/html" href="https://exemplo.com/fed"/>
    <id>urn:uuid:1</id>
    <updated>2026-10-26T18:00:00Z</updated>
    <published>2026-10-26T17:59:00Z</published>
    <summary>Resumo <i>curto</i></summary>
    <category term="economia"/>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <item><title>Item RDF</title><link>https://exemplo.com/rdf</link><dc:date>2026-10-26T12:00:00-03:00</dc:date></item>
</rdf:RDF>`;

describe('leitor de feeds', () => {
  it('RSS 2.0: título sem entidades, trecho sem HTML/script, data com fuso, categorias', () => {
    const r = parseFeed(RSS);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({
      guid: 'abc-123',
      url: 'https://www.exemplo.com.br/mercados/ibov-sobe/?utm_source=rss',
      title: 'Petrobras & Vale: Ibovespa sobe 2%',
      snippet: 'O Ibovespa subiu "forte" hoje.',
      publishedAt: Date.UTC(2026, 9, 26, 12, 30),
      categories: ['Mercados', 'Ações'],
    });
    expect(r[1]!.publishedAt).toBe(Date.UTC(2026, 9, 26, 13, 0));
    expect(r[2]!.publishedAt).toBeNull();
  });

  it('Atom: link "alternate", publicação antes de atualização', () => {
    const [e] = parseFeed(ATOM);
    expect(e).toMatchObject({
      url: 'https://exemplo.com/fed',
      title: 'Fed mantém juros',
      snippet: 'Resumo curto',
      publishedAt: Date.UTC(2026, 9, 26, 17, 59),
      categories: ['economia'],
    });
  });

  it('RSS 1.0 (RDF) com dc:date', () => {
    expect(parseFeed(RDF)[0]).toMatchObject({
      url: 'https://exemplo.com/rdf',
      publishedAt: Date.UTC(2026, 9, 26, 15),
    });
  });

  it('DOCTYPE com entidades é ignorado (sem expansão)', () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>
      <rss><channel><item><title>&b;</title><link>https://x.com/1</link></item></channel></rss>`;
    const [i] = parseFeed(bomb);
    expect(i!.title.length).toBeLessThan(10);
  });

  it('não é feed: erro claro', () => {
    expect(() => parseFeed('<html><body>oi</body></html>')).toThrow(/não é RSS nem Atom/);
  });

  it('trecho: corta em palavra inteira com reticências; HTML limpo', () => {
    expect(clip('palavra '.repeat(80)).length).toBeLessThanOrEqual(300);
    expect(clip('palavra '.repeat(80)).endsWith('…')).toBe(true);
    expect(stripHtml('<p>a&nbsp;b &#8212; c</p>')).toBe('a b — c');
    // HTML escapado dentro do feed
    expect(stripHtml('&lt;p&gt;Alta de 2% &amp;amp; volume&lt;/p&gt;')).toBe('Alta de 2% & volume');
    expect(parseFeedDate('2026-10-26T12:00:00Z')).toBe(Date.UTC(2026, 9, 26, 12));
    expect(parseFeedDate('')).toBeNull();
  });
});

describe('SEC 8-K', () => {
  it('empresa, CIK e itens do 8-K', () => {
    const info = parseSec8k({
      guid: null,
      url: 'https://www.sec.gov/Archives/edgar/data/320193/x-index.htm',
      title: '8-K - APPLE INC (0000320193) (Filer)',
      snippet: null,
      publishedAt: null,
      categories: [],
      rawSummary:
        '<b>Filed:</b> 2026-10-30 <b>AccNo:</b> 0000320193-26-000100 <b>Size:</b> 1 MB<br>Item 2.02: Results of Operations<br>Item 9.01: Financial Statements and Exhibits<br>Item 2.02',
    });
    expect(info).toEqual({
      cik: 320193,
      company: 'APPLE INC',
      items: [
        { code: '2.02', label: 'resultados' },
        { code: '9.01', label: 'item' },
      ],
    });
  });
});

describe('busca condicional', () => {
  it('manda ETag/Last-Modified e entende 304', async () => {
    const seen: Record<string, string>[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>);
      return new Response(null, { status: 304 });
    }) as never;
    const r = await fetchFeed('https://x.com/rss', {
      source: 'x',
      userAgent: 'Radar teste',
      etag: '"v1"',
      lastModified: 'Mon, 26 Oct 2026 12:00:00 GMT',
      fetch: f,
    });
    expect(r.status).toBe(304);
    expect(seen[0]).toMatchObject({
      'user-agent': 'Radar teste',
      'if-none-match': '"v1"',
      'if-modified-since': 'Mon, 26 Oct 2026 12:00:00 GMT',
    });
  });

  it('200 devolve corpo e validadores; erro HTTP vira mensagem clara', async () => {
    const ok = (async () =>
      new Response('<rss/>', { status: 200, headers: { etag: '"v2"' } })) as never;
    expect(await fetchFeed('u', { source: 'x', userAgent: 'u', fetch: ok })).toEqual({
      status: 200,
      body: '<rss/>',
      etag: '"v2"',
      lastModified: null,
    });
    const bad = (async () => new Response('x', { status: 403 })) as never;
    await expect(fetchFeed('u', { source: 'Fonte X', userAgent: 'u', fetch: bad })).rejects.toThrow(
      /Fonte X respondeu HTTP 403/,
    );
  });
});
