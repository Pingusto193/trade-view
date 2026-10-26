import { describe, expect, it } from 'vitest';
import { computeFundamentals } from '@radar/core';
import type { Candle } from '@radar/shared';
import { unzipSync } from 'fflate';
import {
  AlpacaAdapter,
  BcbClient,
  BinanceAdapter,
  NEWS_SOURCES,
  fetchFeed,
  parseFeed,
  BrapiAdapter,
  CVM_SOURCE,
  CvmClient,
  SEC_SOURCE,
  SGS,
  SecEdgarClient,
  TwelveDataAdapter,
  cvmFactsFor,
  isFatoRelevante,
  parseCotahist,
  parseCotahistLine,
} from '../src';

/**
 * Testes de integração REAIS — só rodam com RADAR_LIVE_TESTS=1 e internet.
 * Comando: `pnpm test:live`. No GitHub rodam pelo workflow "Dados reais" (`.github/workflows/live.yml`);
 * o ambiente onde o código foi escrito não tem rede para essas fontes.
 */
const live = Boolean(process.env.RADAR_LIVE_TESTS);

/** Candle coerente: mínima ≤ abertura/fechamento ≤ máxima, preço positivo. */
const sane = (c: Candle) =>
  c.low > 0 && c.low <= Math.min(c.open, c.close) && Math.max(c.open, c.close) <= c.high;

describe.skipIf(!live)('integração real (internet)', () => {
  it('Binance: 10 candles diários de BTCUSDT', async () => {
    const c = await new BinanceAdapter().getCandles({ symbol: 'BTCUSDT', tf: '1d', limit: 10 });
    expect(c).toHaveLength(10);
    expect(c.every((x) => x.high >= x.low && x.volume > 0)).toBe(true);
  }, 30_000);

  it('Binance: metadados de BTCUSDT', async () => {
    const m = await new BinanceAdapter().getMeta('BTCUSDT');
    expect(m.tickSize).toBeGreaterThan(0);
  }, 30_000);

  it('Binance: WebSocket entrega o candle de 1 minuto em formação', async () => {
    const got = await new Promise<{ candle: Candle; closed: boolean }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('sem mensagem do WebSocket em 30 s')),
        30_000,
      );
      const sub = new BinanceAdapter().subscribe('BTCUSDT', '1m', {
        onCandle: (u) => {
          clearTimeout(timer);
          sub.close();
          resolve(u);
        },
        onStatus: () => undefined,
      });
    });
    expect(sane(got.candle)).toBe(true);
    expect(Math.abs(got.candle.time - Date.now())).toBeLessThan(5 * 60_000);
  }, 40_000);

  it('brapi: PETR4 sem token (a documentação se contradiz; o resultado vai para DATA_SOURCES §3)', async () => {
    const token = process.env.BRAPI_TOKEN;
    const brapi = new BrapiAdapter(token ? { token } : {});
    try {
      const c = await brapi.getCandles({ symbol: 'PETR4', tf: '1d', limit: 5 });
      console.info(`[brapi] ${token ? 'com' : 'sem'} token: ${c.length} candles`);
      expect(c.length).toBeGreaterThan(0);
      expect(c.every(sane)).toBe(true);
    } catch (e) {
      console.info(`[brapi] ${token ? 'com' : 'sem'} token: erro "${(e as Error).message}"`);
      // sem token, recusar é aceitável (vira o fato registrado); com token tem que funcionar
      if (token) throw e;
      expect((e as Error).message.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it('B3: arquivo diário do COTAHIST mais recente, PETR4 com campos nas posições certas', async () => {
    let found: { day: Date; bytes: Uint8Array } | null = null;
    for (let back = 1; back <= 10 && !found; back++) {
      const day = new Date(Date.now() - back * 86_400_000);
      const dd = String(day.getUTCDate()).padStart(2, '0');
      const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
      const url = `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D${dd}${mm}${day.getUTCFullYear()}.ZIP`;
      const r = await fetch(url);
      const bytes = new Uint8Array(await r.arrayBuffer());
      // fim de semana/feriado: a B3 pode devolver erro ou uma página em vez do ZIP
      if (r.ok && bytes[0] === 0x50 && bytes[1] === 0x4b) found = { day, bytes };
    }
    expect(found, 'nenhum COTAHIST diário nos últimos 10 dias').not.toBeNull();
    const files = unzipSync(found!.bytes);
    const name = Object.keys(files)[0]!;
    const text = new TextDecoder('latin1').decode(files[name]);
    const petr = parseCotahist(text, new Set(['PETR4'])).get('PETR4');
    expect(petr).toHaveLength(1);
    const c = petr![0]!;
    const rec = text
      .split(/\r?\n/)
      .map(parseCotahistLine)
      .find((r) => r?.ticker === 'PETR4' && r.market === '010')!;
    console.info(
      `[cotahist] ${name}: PETR4 ${JSON.stringify(c)} nome="${rec.name}" negócios=${rec.trades} financeiro=${rec.financialVolume}`,
    );
    expect(sane(c)).toBe(true);
    // diário = meia-noite UTC da data do pregão (ADR-0006), igual à data do arquivo
    const d = found!.day;
    expect(c.time).toBe(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    expect(rec.name).toMatch(/PETROBRAS/);
    expect(rec.trades).toBeGreaterThan(0);
    // prova das posições de quantidade (QUATOT) e volume financeiro (VOLTOT): o preço médio do dia
    // (financeiro ÷ quantidade) tem que cair entre a mínima e a máxima
    const avg = rec.financialVolume / c.volume;
    expect(avg).toBeGreaterThanOrEqual(c.low);
    expect(avg).toBeLessThanOrEqual(c.high);
    // fonte independente: o mesmo pregão na brapi (diferença ≤ 1%; a brapi pode ajustar proventos)
    const b = (await new BrapiAdapter().getCandles({ symbol: 'PETR4', tf: '1d', limit: 15 })).find(
      (x) => x.time === c.time,
    );
    console.info(`[cotahist × brapi] ${JSON.stringify(b ?? null)}`);
    expect(b, 'brapi sem o mesmo pregão (ou com outro horário do candle)').toBeDefined();
    for (const k of ['open', 'high', 'low', 'close'] as const)
      expect(Math.abs(b![k] / c[k] - 1), k).toBeLessThan(0.01);
  }, 120_000);

  it.skipIf(!process.env.ALPACA_KEY_ID || !process.env.ALPACA_SECRET_KEY)(
    'Alpaca: 10 candles diários da AAPL (plano gratuito)',
    async () => {
      const alpaca = new AlpacaAdapter({
        keyId: process.env.ALPACA_KEY_ID,
        secretKey: process.env.ALPACA_SECRET_KEY,
      });
      const c = await alpaca.getCandles({ symbol: 'AAPL', tf: '1d', limit: 10 });
      expect(c.length).toBeGreaterThan(0);
      expect(c.every(sane)).toBe(true);
    },
    30_000,
  );

  it.skipIf(!process.env.TWELVE_DATA_KEY)(
    'Twelve Data: EUR/USD em 1 min e diário; USD/BRL e EUR/BRL (fatos ❌ de DATA_SOURCES §5.1)',
    async () => {
      const td = new TwelveDataAdapter({ apiKey: process.env.TWELVE_DATA_KEY });
      const m1 = await td.getCandles({ symbol: 'EURUSD', tf: '1m', limit: 30 });
      expect(m1.length).toBeGreaterThan(0);
      expect(m1.every(sane)).toBe(true);
      expect(m1.every((c) => c.volume === 0)).toBe(true);
      const last = m1.at(-1)!;
      console.info(
        `[twelvedata] último candle de 1 min: ${new Date(last.time).toISOString()} (há ${Math.round((Date.now() - last.time) / 1000)} s; fim de semana = sexta)`,
      );
      const d1 = await td.getCandles({ symbol: 'EURUSD', tf: '1d', limit: 10 });
      expect(d1.every(sane)).toBe(true);
      const wd = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
      console.info(
        `[twelvedata] diário (data e dia da semana em UTC): ${d1
          .map(
            (c) =>
              `${new Date(c.time).toISOString().slice(0, 10)} ${wd[new Date(c.time).getUTCDay()]}`,
          )
          .join(', ')}`,
      );
      for (const p of ['USDBRL', 'EURBRL']) {
        try {
          const c = await td.getCandles({ symbol: p, tf: '1d', limit: 3 });
          console.info(
            `[twelvedata] ${p}: ${c.length} candles, último fechamento ${c.at(-1)?.close}`,
          );
        } catch (e) {
          console.info(`[twelvedata] ${p}: erro "${(e as Error).message}"`);
        }
      }
      console.info(`[twelvedata] consultas nesta rodada: ${JSON.stringify(td.quota())}`);
    },
    60_000,
  );

  it('BCB: Meta Selic (432) e CDI (12)', async () => {
    const bcb = new BcbClient();
    const selic = await bcb.getLast(SGS.SELIC_META, 1);
    const cdi = await bcb.getLast(SGS.CDI_DIARIO, 5);
    expect(selic[0]?.value).toBeGreaterThan(0);
    expect(cdi.length).toBe(5);
  }, 30_000);

  // SEC exige identificação com contato: SEC_USER_AGENT="Seu nome seu@email" pnpm test:live
  it.skipIf(!process.env.SEC_USER_AGENT)(
    'SEC EDGAR: ticker → CIK e companyfacts da Apple (AAPL)',
    async () => {
      const sec = new SecEdgarClient({ userAgent: process.env.SEC_USER_AGENT });
      const cik = (await sec.tickers()).get('AAPL')?.cik;
      expect(cik).toBeGreaterThan(0);
      const facts = await sec.companyFacts(cik!);
      const fu = computeFundamentals(facts.facts, { source: SEC_SOURCE, asOf: Date.now() });
      expect(fu.periodEnd).toBeGreaterThan(Date.now() - 550 * 86_400_000);
      expect(fu.revenueNoDecline === null).toBe(false);
    },
    60_000,
  );

  it('CVM: FCA (ticker → CNPJ) e DFP do ano passado para a PETR4', async () => {
    const cvm = new CvmClient();
    const y = new Date().getUTCFullYear();
    const map = await cvm.fca(y).catch(() => cvm.fca(y - 1));
    const petr = map.get('PETR4');
    expect(petr?.cnpj).toMatch(/^\d{14}$/);
    const lines = [...(await cvm.dfp(y - 2)).lines, ...(await cvm.dfp(y - 1)).lines].filter(
      (l) => l.cnpj === petr!.cnpj,
    );
    const { facts } = cvmFactsFor(lines, petr!.shareClass);
    const fu = computeFundamentals(facts, { source: CVM_SOURCE, asOf: Date.now() });
    expect(fu.revenueNoDecline === null && fu.epsGrowth2y === null).toBe(false);
  }, 300_000);
});

describe.skipIf(!live)('CVM IPE (fatos relevantes, estudo de evento)', () => {
  it('IPE do ano: colunas exigidas, fatos relevantes da Petrobras e a data de entrega', async () => {
    const cvm = new CvmClient();
    const y = new Date().getUTCFullYear();
    const ev = await cvm.ipe(y);
    const map = await cvm.fca(y).catch(() => cvm.fca(y - 1));
    const petr = map.get('PETR4')!;
    const fr = ev.filter((e) => e.cnpj === petr.cnpj && isFatoRelevante(e));
    const cats = [...new Set(ev.map((e) => e.category))].slice(0, 12);
    console.info(
      `[cvm-ipe] ${y}: ${ev.length} documentos; categorias: ${cats.join(' | ')}; PETR4 fatos relevantes: ${fr.length}; último: ${JSON.stringify(fr.at(-1) ?? null)}; mais recente de todos: ${new Date(Math.max(...ev.map((e) => e.deliveredAt))).toISOString().slice(0, 10)}`,
    );
    expect(ev.length).toBeGreaterThan(100);
    expect(ev.some(isFatoRelevante)).toBe(true);
  }, 300_000);
});

// Notícias (SPEC §23.1): formato e atraso reais de cada fonte ligada (DATA_SOURCES §19)
const NEWS_UA = 'Radar/1.0 (app pessoal; +https://github.com/Pingusto193/trade-view)';
describe.skipIf(!live)('notícias reais (formato e atraso)', () => {
  for (const s of NEWS_SOURCES) {
    const ua = s.requires === 'SEC_USER_AGENT' ? process.env.SEC_USER_AGENT : NEWS_UA;
    it.skipIf(!ua)(
      `${s.label}: o feed responde, é RSS/Atom e tem itens`,
      async () => {
        const r = await fetchFeed(s.url, { source: s.label, userAgent: ua! });
        expect(r.status).toBe(200);
        const items = parseFeed(r.status === 200 ? r.body : '');
        const dated = items.filter((i) => i.publishedAt !== null);
        const newest = dated.length ? Math.max(...dated.map((i) => i.publishedAt as number)) : null;
        console.info(
          `[news] ${s.id}: ${items.length} itens, ${dated.length} com data; mais novo ${
            newest
              ? `${new Date(newest).toISOString()} (há ${Math.round((Date.now() - newest) / 60_000)} min)`
              : '—'
          }; ex.: "${items[0]?.title ?? ''}" ${items[0]?.url ?? ''}`,
        );
        expect(items.length).toBeGreaterThan(0);
      },
      30_000,
    );
  }

  it('descoberta de formato (só registra): Copom, IBGE, BLS e Agência Brasil', async () => {
    const sec = process.env.SEC_USER_AGENT;
    const probes: { url: string; ua?: string; headers?: Record<string, string>; why: string }[] = [
      {
        url: 'https://www.bcb.gov.br/api/servico/sitebcb/copom/comunicados_detalhes?nro_reuniao=281',
        why: 'texto, hora e link do comunicado do Copom',
      },
      {
        url: 'https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/comunicadoscopom',
        why: 'feed RSS de comunicados do Copom (nome adivinhado)',
      },
      {
        url: 'https://www.bcb.gov.br/publicacoes/comunicadoscopom/cronologicos',
        why: 'página pública dos comunicados (link original)',
      },
      {
        url: 'https://servicodados.ibge.gov.br/api/v3/calendario/?qtd=3',
        why: 'calendário IBGE (listagem geral)',
      },
      {
        url: 'https://servicodados.ibge.gov.br/api/v3/agregados/7060/periodos/-1/variaveis/63?localidades=N1[all]',
        why: 'o host do IBGE responde a qualquer coisa?',
      },
      {
        url: 'https://www.bls.gov/feed/empsit.rss',
        headers: { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.1' },
        why: 'BLS sem e-mail, com Accept de leitor de RSS',
      },
      ...(sec
        ? [
            { url: 'https://www.bls.gov/feed/empsit.rss', ua: sec, why: 'BLS com e-mail no UA' },
            {
              url: 'https://www.bls.gov/schedule/news_release/bls.ics',
              ua: sec,
              why: 'agenda BLS com e-mail no UA',
            },
          ]
        : []),
      {
        url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml',
        why: 'Agência Brasil geral (o de Economia estava 66 h parado numa segunda à tarde)',
      },
    ];
    for (const p of probes) {
      try {
        const r = await fetch(p.url, {
          headers: { 'user-agent': p.ua ?? NEWS_UA, ...p.headers },
          signal: AbortSignal.timeout(20_000),
        });
        const body = await r.text();
        let extra = '';
        if (/xml|rss/.test(r.headers.get('content-type') ?? '') || body.startsWith('<?xml')) {
          try {
            const items = parseFeed(body);
            const dates = items
              .map((i) => i.publishedAt)
              .filter((t): t is number => t !== null)
              .sort((a, b) => b - a)
              .slice(0, 3)
              .map(
                (t) =>
                  `${new Date(t).toISOString()} (há ${Math.round((Date.now() - t) / 60_000)} min)`,
              );
            extra = `\n  ${items.length} itens; mais novos: ${dates.join(', ')}`;
          } catch (e) {
            extra = `\n  não lê como feed: ${(e as Error).message}`;
          }
        }
        console.info(
          `[descoberta] ${p.why}: ${p.url} → HTTP ${r.status} ${r.headers.get('content-type')}${extra}\n${body.slice(0, 600)}`,
        );
      } catch (e) {
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        console.info(
          `[descoberta] ${p.why}: ${p.url} → erro ${(e as Error).message} ${cause?.code ?? ''} ${cause?.message ?? ''}`,
        );
      }
    }
  }, 240_000);
});
