import type { NewsSourceDef } from '@radar/data';
import type { Candle } from '@radar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { DAY, testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const D0 = Date.UTC(2026, 6, 1);
const NOW = D0 + 100 * DAY;
/** Diário com uma alta de 5% no dia 60 (o dia da notícia). */
const candles: Candle[] = Array.from({ length: 90 }, (_, i) => {
  const c = i < 60 ? 100 : 105;
  return { time: D0 + i * DAY, open: c, high: c + 1, low: c - 1, close: c, volume: 1 };
});

const src: NewsSourceDef = {
  id: 'a',
  label: 'Fonte a',
  kind: 'noticia',
  lang: 'pt',
  url: 'https://a.exemplo/rss',
  intervalMs: 300_000,
  reader: 'feed',
  terms: 'teste',
  aiSummary: false,
};
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Petrobras (PETR4) anuncia dividendos extraordinários</title><link>https://a.exemplo/1</link><pubDate>${new Date(D0 + 60 * DAY + 14 * 3_600_000).toUTCString()}</pubDate></item></channel></rss>`;

describe('estudo de evento', () => {
  it('notícias do Radar + fatos relevantes da CVM (ação da B3 no diário)', async () => {
    const cnpj = '33000167000101';
    const cvm = {
      fca: async () => new Map([['PETR4', { ticker: 'PETR4', cnpj, shareClass: 'PN' }]]),
      ipe: async (y: number) =>
        y === 2026
          ? [
              {
                cnpj,
                company: 'PETROBRAS',
                category: 'Fato Relevante',
                type: '',
                subject: 'x',
                deliveredAt: D0 + 60 * DAY,
                link: null,
              },
              {
                cnpj,
                company: 'PETROBRAS',
                category: 'Comunicado ao Mercado',
                type: '',
                subject: 'y',
                deliveredAt: D0 + 30 * DAY,
                link: null,
              },
              {
                cnpj: '1'.repeat(14),
                company: 'OUTRA',
                category: 'Fato Relevante',
                type: '',
                subject: 'z',
                deliveredAt: D0 + 10 * DAY,
                link: null,
              },
            ]
          : [],
    };
    const t = await testApp({
      now: () => NOW,
      cvm: cvm as never,
      newsSources: [src],
      newsFetch: (async () => new Response(rss, { status: 200 })) as never,
    });
    close = () => t.app.close();
    t.fake.candles = candles;
    t.fake.metaPatch = { market: 'b3', symbol: 'PETR4' };
    await t.app.inject({ method: 'POST', url: '/api/news/sources/a/poll' });
    const r = await t.app.inject({ url: '/api/news/event-study?symbolId=fake:PETR4&tf=1d' });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.radar.events).toBe(1);
    const g = b.radar.study.groups.find((x: { group: string }) => x.group === 'tipo:noticia');
    // publicada no dia 60 (14h UTC): referência = fechamento do dia 59; 1 dia depois: +5%
    expect(g.horizons[0]).toMatchObject({ horizon: 1, n: 1 });
    expect(g.horizons[0].medianMove).toBeCloseTo(0.05, 9);
    expect(b.cvm).toMatchObject({ events: 1, errors: [] });
    expect(b.cvm.study.groups[0].group).toBe('cvm:fato-relevante');
    expect(b.cvm.study.groups[0].horizons[0].medianMove).toBeCloseTo(0.05, 9);
    expect(b.notes.join(' ')).toMatch(/só a DATA/);
  });
});
