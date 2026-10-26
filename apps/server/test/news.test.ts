import type { NewsSourceDef } from '@radar/data';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client';
import { NewsService } from '../src/news/service';
import { testApp } from './helpers';

const T0 = Date.UTC(2026, 9, 26, 13, 0);
const MIN = 60_000;

const rss = (items: { t: string; link: string; min: number }[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel>${items
    .map(
      (i) =>
        `<item><title>${i.t}</title><link>${i.link}</link><pubDate>${new Date(T0 + i.min * MIN).toUTCString()}</pubDate><description>trecho</description></item>`,
    )
    .join('')}</channel></rss>`;

const src = (id: string, extra: Partial<NewsSourceDef> = {}): NewsSourceDef => ({
  id,
  label: `Fonte ${id}`,
  kind: 'noticia',
  lang: 'pt',
  url: `https://${id}.exemplo/rss`,
  intervalMs: 5 * MIN,
  reader: 'feed',
  terms: 'teste',
  aiSummary: true,
  ...extra,
});

/** Fetch falso: corpo por URL, com ETag e 304 quando o cliente manda o mesmo ETag. */
function fakeFetch(bodies: Record<string, { body: string; etag?: string; status?: number }>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    const r = bodies[url];
    if (!r) return new Response('não', { status: 404 });
    if (r.status) return new Response('erro', { status: r.status });
    if (r.etag && headers['if-none-match'] === r.etag) return new Response(null, { status: 304 });
    return new Response(r.body, { status: 200, headers: r.etag ? { etag: r.etag } : {} });
  }) as never;
  return { fn, calls };
}

function service(
  sources: NewsSourceDef[],
  bodies: Parameters<typeof fakeFetch>[0],
  extra: { secUserAgent?: string; cik?: Map<number, string> } = {},
) {
  let now = T0;
  const db = openDb(':memory:');
  const f = fakeFetch(bodies);
  const fresh: string[] = [];
  const svc = new NewsService(db, {
    sources,
    userAgent: 'Radar teste',
    fetch: f.fn,
    now: () => now,
    onNew: (items) => fresh.push(...items.map((i) => i.title)),
    ...(extra.secUserAgent ? { secUserAgent: extra.secUserAgent } : {}),
    ...(extra.cik ? { cikTickers: async () => extra.cik as Map<number, string> } : {}),
  });
  return { svc, db, f, fresh, setNow: (t: number) => (now = t) };
}

describe('ingestão de notícias', () => {
  it('primeira leitura = acervo; depois, notícia nova com atraso medido e aviso', async () => {
    const bodies: Parameters<typeof fakeFetch>[0] = {
      'https://a.exemplo/rss': {
        body: rss([
          {
            t: 'Dólar sobe com Copom no radar dos investidores',
            link: 'https://a.exemplo/1',
            min: -30,
          },
          {
            t: 'Petrobras anuncia dividendos extraordinários hoje',
            link: 'https://a.exemplo/2',
            min: -20,
          },
        ]),
        etag: '"v1"',
      },
    };
    const { svc, f, fresh, setNow } = service([src('a')], bodies);
    expect(await svc.poll('a')).toEqual({ added: 2, notModified: false });
    expect(fresh).toEqual([]); // acervo não avisa
    expect(svc.query({ limit: 50, duplicates: false }).every((i) => i.backlog)).toBe(true);

    // mesmo ETag: 304, nada muda
    setNow(T0 + 5 * MIN);
    expect(await svc.poll('a')).toEqual({ added: 0, notModified: true });
    expect(f.calls.at(-1)!.headers['if-none-match']).toBe('"v1"');

    // notícia nova publicada 2 min antes da leitura
    bodies['https://a.exemplo/rss'] = {
      body: rss([
        {
          t: 'Ibovespa renova máxima com fluxo estrangeiro forte',
          link: 'https://a.exemplo/3',
          min: 8,
        },
      ]),
      etag: '"v2"',
    };
    setNow(T0 + 10 * MIN);
    expect((await svc.poll('a')).added).toBe(1);
    expect(fresh).toEqual(['Ibovespa renova máxima com fluxo estrangeiro forte']);
    const st = svc.sources()[0]!;
    expect(st.delay).toEqual({ n: 1, medianMs: 2 * MIN, p90Ms: 2 * MIN });
    expect(st.lastError).toBeNull();
  });

  it('mesma notícia em outra fonte vira duplicata; o feed mostra uma só', async () => {
    const { svc, setNow } = service([src('a'), src('b')], {
      'https://a.exemplo/rss': {
        body: rss([
          {
            t: 'Copom mantém Selic em 15% e sinaliza cortes em 2027',
            link: 'https://a.exemplo/x',
            min: 0,
          },
        ]),
      },
      'https://b.exemplo/rss': {
        body: rss([
          {
            t: 'Copom mantém a Selic em 15% e sinaliza cortes para 2027',
            link: 'https://b.exemplo/y',
            min: 1,
          },
        ]),
      },
    });
    await svc.poll('a');
    setNow(T0 + 2 * MIN);
    await svc.poll('b');
    const all = svc.query({ limit: 50, duplicates: true });
    expect(all).toHaveLength(2);
    const dup = all.find((i) => i.sourceId === 'b')!;
    expect(dup.duplicateOf).toBe(all.find((i) => i.sourceId === 'a')!.id);
    expect(svc.query({ limit: 50, duplicates: false })).toHaveLength(1);
  });

  it('feed filtrado pelo ativo: mini-dólar recebe Copom/dólar; PETR4 recebe Petrobras', async () => {
    const { svc } = service([src('a')], {
      'https://a.exemplo/rss': {
        body: rss([
          {
            t: 'Dólar sobe com Copom no radar dos investidores',
            link: 'https://a.exemplo/1',
            min: 0,
          },
          {
            t: 'Petrobras anuncia dividendos extraordinários hoje',
            link: 'https://a.exemplo/2',
            min: 1,
          },
        ]),
      },
    });
    await svc.poll('a');
    const wdo = svc.query({ symbols: ['mt5:WDOZ26'], limit: 50, duplicates: false });
    expect(wdo.map((i) => i.title)).toEqual(['Dólar sobe com Copom no radar dos investidores']);
    const petr = svc.query({ symbols: ['brapi:PETR4'], limit: 50, duplicates: false });
    expect(petr.map((i) => i.title)).toEqual(['Petrobras anuncia dividendos extraordinários hoje']);
    expect(svc.query({ symbols: ['binance:BTCUSDT'], limit: 50, duplicates: false })).toEqual([]);
  });

  it('feed geral: só entram notícias associadas a algum ativo', async () => {
    const { svc } = service([src('a', { onlyTagged: true })], {
      'https://a.exemplo/rss': {
        body: rss([
          { t: 'Time vence clássico e lidera o campeonato', link: 'https://a.exemplo/f', min: 0 },
          {
            t: 'Dólar sobe com Copom no radar dos investidores',
            link: 'https://a.exemplo/d',
            min: 1,
          },
        ]),
      },
    });
    expect(await svc.poll('a')).toEqual({ added: 1, notModified: false });
    expect(svc.query({ limit: 5, duplicates: false }).map((i) => i.title)).toEqual([
      'Dólar sobe com Copom no radar dos investidores',
    ]);
  });

  it('erro da fonte fica registrado (nada inventado)', async () => {
    const { svc } = service([src('a')], { 'https://a.exemplo/rss': { body: '', status: 500 } });
    await expect(svc.poll('a')).rejects.toThrow(/HTTP 500/);
    expect(svc.sources()[0]).toMatchObject({
      lastError: expect.stringMatching(/HTTP 500/),
      lastOkAt: null,
    });
  });

  it('SEC 8-K: desligada sem SEC_USER_AGENT; com ele, CIK → código e itens no título', async () => {
    const sec = src('sec', {
      kind: 'sec-8k',
      lang: 'en',
      reader: 'sec-8k',
      requires: 'SEC_USER_AGENT',
      url: 'https://sec.exemplo/atom',
    });
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title>8-K - APPLE INC (0000320193) (Filer)</title>
      <link rel="alternate" href="https://www.sec.gov/Archives/edgar/data/320193/x-index.htm"/>
      <summary type="html">&lt;b&gt;Filed:&lt;/b&gt; 2026-10-26 Item 2.02: Results of Operations</summary>
      <updated>2026-10-26T09:00:00-04:00</updated><id>urn:1</id></entry></feed>`;
    const off = service([sec], { 'https://sec.exemplo/atom': { body: atom } });
    expect(off.svc.sources()[0]).toMatchObject({ enabled: false });
    await expect(off.svc.poll('sec')).rejects.toThrow(/SEC_USER_AGENT/);

    const on = service(
      [sec],
      { 'https://sec.exemplo/atom': { body: atom } },
      {
        secUserAgent: 'Radar teste voce@exemplo.com',
        cik: new Map([[320193, 'AAPL']]),
      },
    );
    await on.svc.poll('sec');
    expect(on.f.calls[0]!.headers['user-agent']).toBe('Radar teste voce@exemplo.com');
    const [item] = on.svc.query({ symbols: ['alpaca:AAPL'], limit: 5, duplicates: false });
    expect(item!.title).toBe('8-K APPLE INC (AAPL) — 2.02 resultados');
    expect(item!.kind).toBe('sec-8k');
  });
});

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('rotas de notícias', () => {
  it('GET /api/news filtra por ativo; /api/news/sources mostra a saúde; leitura manual', async () => {
    const f = fakeFetch({
      'https://a.exemplo/rss': {
        body: rss([
          {
            t: 'Dólar sobe com Copom no radar dos investidores',
            link: 'https://a.exemplo/1',
            min: 0,
          },
        ]),
      },
    });
    const t = await testApp({ now: () => T0, newsSources: [src('a')], newsFetch: f.fn });
    close = () => t.app.close();
    const poll = await t.app.inject({ method: 'POST', url: '/api/news/sources/a/poll' });
    expect(poll.json()).toEqual({ added: 1, notModified: false });
    const r = await t.app.inject({ url: '/api/news?symbols=mt5:WDOZ26,brapi:PETR4&limit=10' });
    expect(r.json().items).toHaveLength(1);
    expect(r.json().items[0]).toMatchObject({ sourceLabel: 'Fonte a', backlog: true });
    const none = await t.app.inject({ url: '/api/news?symbols=binance:BTCUSDT' });
    expect(none.json().items).toEqual([]);
    const s = await t.app.inject({ url: '/api/news/sources' });
    expect(s.json().sources[0]).toMatchObject({ id: 'a', enabled: true, lastError: null });
    const bad = await t.app.inject({ method: 'POST', url: '/api/news/sources/xyz/poll' });
    expect(bad.statusCode).toBe(502);
  });
});
