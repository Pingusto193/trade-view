import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importCotahist } from '../src/market/cotahist-import';
import { testApp } from './helpers';

function line(date: string, ticker: string, close: number): string {
  const arr = Array.from({ length: 245 }, () => ' ');
  const put = (pos: number, v: string) => {
    for (let i = 0; i < v.length; i++) arr[pos - 1 + i] = v[i] as string;
  };
  const n = (v: number, w: number) => String(Math.round(v)).padStart(w, '0');
  put(1, '01');
  put(3, date);
  put(11, '02');
  put(13, ticker.padEnd(12, ' '));
  put(25, '010');
  put(57, n(close * 100, 13));
  put(70, n(close * 100 + 50, 13));
  put(83, n(close * 100 - 50, 13));
  put(109, n(close * 100, 13));
  put(153, n(1000, 18));
  put(211, n(1, 7));
  return arr.join('');
}

describe('importação do COTAHIST', () => {
  it('lê um ZIP, grava como cotahist:<código> e aponta gaps suspeitos', async () => {
    const t = await testApp();
    const txt = [
      line('20240102', 'PETR4', 38),
      line('20240103', 'PETR4', 19),
      line('20240102', 'VALE3', 70),
    ].join('\n');
    const zip = zipSync({ 'COTAHIST_A2024.TXT': new TextEncoder().encode(txt) });
    const r = importCotahist(t.store, zip, new Set(['PETR4']));
    expect(r).toMatchObject({ tickers: 1, candles: 2 });
    expect(Object.keys(r.suspicious)).toEqual(['PETR4']);
    expect(t.store.load('cotahist:PETR4', '1d').map((c) => c.close)).toEqual([38, 19]);
    expect(t.store.load('cotahist:VALE3', '1d')).toEqual([]);
    await t.app.close();
  });
});

describe('B3: emenda COTAHIST + brapi', () => {
  it('histórico antigo vem do COTAHIST e o recente da brapi, com aviso de série não ajustada', async () => {
    const { readFileSync } = await import('node:fs');
    const { BrapiAdapter, AdapterRegistry } = await import('@radar/data');
    const { buildApp } = await import('../src/app');
    const { openDb } = await import('../src/db/client');
    const { envSchema } = await import('../src/env');
    const body = readFileSync(
      new URL('../../../packages/data/fixtures/brapi-quote-history.json', import.meta.url),
      'utf8',
    );
    const brapi = new BrapiAdapter({ fetch: async () => new Response(body) });
    const env = envSchema.parse({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' });
    const radar = await buildApp({
      env,
      db: openDb(':memory:'),
      registry: new AdapterRegistry([brapi]),
      logger: false,
      now: () => Date.UTC(2025, 9, 14, 22),
    });
    const txt = [
      line('20250929', 'PETR4', 29),
      line('20250930', 'PETR4', 29.5),
      line('20251006', 'PETR4', 99),
    ].join('\n');
    importCotahist(radar.store, new TextEncoder().encode(txt));
    const r = await radar.app.inject({ url: '/api/candles?id=brapi:PETR4&tf=1d' });
    const j = r.json();
    // 2 dias do COTAHIST anteriores ao 1º dia da brapi (06/10), depois os 4 da brapi
    expect(j.candles.map((c: { close: number }) => c.close)).toEqual([
      29, 29.5, 30.5, 31, 31.8, 32,
    ]);
    expect(j.meta.adjusted).toBe('no');
    expect(j.meta.notes.join(' ')).toMatch(/SEM ajuste/);
    const w = (await radar.app.inject({ url: '/api/candles?id=brapi:PETR4&tf=1w' })).json();
    expect(w.candles).toHaveLength(3);
    await radar.app.close();
  });
});
