import type { FeedStatus } from '@radar/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  AdapterRegistry,
  NotConfiguredError,
  RateLimitError,
  SymbolNotFoundError,
  TwelveDataAdapter,
  parseTdTime,
  parseTdValues,
  type CandleUpdate,
} from '../src';
import { fakeFetch } from './helpers';

// terça-feira, 20/10/2026, 14:00 UTC = 10:00 em Nova York: forex aberto
const TUE = Date.UTC(2026, 9, 20, 14, 0);
// sábado, 24/10/2026: forex fechado
const SAT = Date.UTC(2026, 9, 24, 12, 0);

/** Resposta no formato da documentação: do mais novo para o mais velho, números em texto. */
const series = (rows: [string, number][]) => ({
  meta: { symbol: 'EUR/USD', interval: '1min' },
  status: 'ok',
  values: rows.map(([datetime, c]) => ({
    datetime,
    open: String(c - 0.0002),
    high: String(c + 0.0003),
    low: String(c - 0.0004),
    close: String(c),
  })),
});

const adapter = (f: ReturnType<typeof fakeFetch>, extra = {}) =>
  new TwelveDataAdapter({
    apiKey: 'chave-teste',
    fetch: f,
    now: () => TUE,
    sleep: async () => undefined,
    ...extra,
  });

describe('Twelve Data: leitura', () => {
  it('horário em UTC (intradiário e diário) e ordem crescente, sem volume', () => {
    expect(parseTdTime('2026-10-20 13:45:00')).toBe(Date.UTC(2026, 9, 20, 13, 45));
    expect(parseTdTime('2026-10-16')).toBe(Date.UTC(2026, 9, 16));
    expect(() => parseTdTime('20/10/2026')).toThrow(/inesperado/);
    const c = parseTdValues(
      series([
        ['2026-10-20 13:46:00', 1.0852],
        ['2026-10-20 13:45:00', 1.0851],
        ['2026-10-20 13:45:00', 1.0851],
      ]).values,
    );
    expect(c.map((x) => x.time)).toEqual([
      Date.UTC(2026, 9, 20, 13, 45),
      Date.UTC(2026, 9, 20, 13, 46),
    ]);
    expect(c[1]).toMatchObject({ close: 1.0852, volume: 0 });
  });

  it('descarta linha com número inválido (nunca inventa)', () => {
    const v = series([['2026-10-20 13:45:00', 1.08]]).values;
    v[0]!.close = 'abc';
    expect(parseTdValues(v)).toEqual([]);
  });

  it('pede EUR/USD em UTC com a chave e devolve os candles', async () => {
    const f = fakeFetch([
      {
        match: (u) => u.includes('/time_series'),
        body: series([
          ['2026-10-20 13:46:00', 1.0852],
          ['2026-10-20 13:45:00', 1.0851],
        ]),
      },
    ]);
    const c = await adapter(f).getCandles({ symbol: 'EURUSD', tf: '1m', limit: 100 });
    expect(c).toHaveLength(2);
    const url = new URL(f.calls[0]!);
    expect(url.searchParams.get('symbol')).toBe('EUR/USD');
    expect(url.searchParams.get('interval')).toBe('1min');
    expect(url.searchParams.get('timezone')).toBe('UTC');
    expect(url.searchParams.get('outputsize')).toBe('100');
    expect(url.searchParams.get('apikey')).toBe('chave-teste');
  });

  it('semanal montado a partir do diário (semana começa na segunda)', async () => {
    const days: [string, number][] = [
      ['2026-10-20', 1.09],
      ['2026-10-19', 1.08],
      ['2026-10-16', 1.07],
      ['2026-10-15', 1.06],
    ];
    const f = fakeFetch([{ match: (u) => u.includes('interval=1day'), body: series(days) }]);
    const w = await adapter(f).getCandles({ symbol: 'EURUSD', tf: '1w' });
    expect(w.map((x) => x.time)).toEqual([Date.UTC(2026, 9, 12), Date.UTC(2026, 9, 19)]);
    expect(w[1]!.close).toBe(1.09);
  });

  it('metadados: forex sem volume, moeda de cotação, iene com 3 casas', async () => {
    const a = adapter(fakeFetch([]));
    const m = await a.getMeta('USDJPY');
    expect(m).toMatchObject({
      id: 'fx:USDJPY',
      market: 'forex',
      currency: 'JPY',
      priceDecimals: 3,
      volume: 'none',
      pointValue: 100_000,
    });
    expect(m.notes.join(' ')).toMatch(/preço MÉDIO/);
    await expect(a.getMeta('XXXYYY')).rejects.toBeInstanceOf(SymbolNotFoundError);
  });

  it('busca na lista de pares, sem gastar consulta', async () => {
    const f = fakeFetch([]);
    const a = adapter(f);
    expect((await a.searchSymbols('eur')).map((r) => r.symbol)).toEqual([
      'EURUSD',
      'EURGBP',
      'EURJPY',
      'EURBRL',
    ]);
    expect((await a.searchSymbols('EUR/USD')).map((r) => r.id)).toEqual(['fx:EURUSD']);
    expect((await a.searchSymbols('real')).map((r) => r.symbol)).toEqual(['USDBRL', 'EURBRL']);
    expect(f.calls).toHaveLength(0);
  });
});

describe('Twelve Data: erros e cota', () => {
  it('erros da fonte viram mensagens claras', async () => {
    const err = (code: number) =>
      adapter(
        fakeFetch([
          {
            match: () => true,
            body: { status: 'error', code, message: `erro ${code}` },
          },
        ]),
      ).getCandles({ symbol: 'EURUSD', tf: '1d' });
    await expect(err(401)).rejects.toThrow(/recusou a chave/);
    await expect(err(400)).rejects.toBeInstanceOf(SymbolNotFoundError);
    await expect(err(429)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('para ANTES de passar do teto diário e volta no dia seguinte (UTC)', async () => {
    let now = TUE;
    const f = fakeFetch([{ match: () => true, body: series([['2026-10-20 13:45:00', 1.08]]) }]);
    const a = adapter(f, { perDay: 2, now: () => now });
    await a.getCandles({ symbol: 'EURUSD', tf: '1m' });
    await a.getCandles({ symbol: 'EURUSD', tf: '1m' });
    await expect(a.getCandles({ symbol: 'EURUSD', tf: '1m' })).rejects.toThrow(
      /Cota diária da Twelve Data esgotada \(2 de 2/,
    );
    expect(f.calls).toHaveLength(2);
    expect(a.quota()).toEqual({ used: 2, limit: 2, day: '2026-10-20' });
    now = Date.UTC(2026, 9, 21, 0, 1);
    await a.getCandles({ symbol: 'EURUSD', tf: '1m' });
    expect(a.quota()).toMatchObject({ used: 1, day: '2026-10-21' });
  });

  it('sem chave: "não configurada", sem nenhuma chamada', async () => {
    const f = fakeFetch([]);
    const a = new TwelveDataAdapter({ fetch: f });
    expect(a.isConfigured()).toBe(false);
    await expect(a.getCandles({ symbol: 'EURUSD', tf: '1d' })).rejects.toBeInstanceOf(
      NotConfiguredError,
    );
    const st: FeedStatus[] = [];
    a.subscribe('EURUSD', '1m', { onCandle: () => undefined, onStatus: (s) => st.push(s) });
    expect(st[0]).toMatchObject({ state: 'not-configured' });
    expect(f.calls).toHaveLength(0);
  });

  it('o registro inclui a fonte de forex (id "fx")', () => {
    const r = AdapterRegistry.fromConfig({ twelveDataKey: 'k' });
    expect(r.get('fx')?.isConfigured()).toBe(true);
    expect(AdapterRegistry.fromConfig({}).get('fx')?.isConfigured()).toBe(false);
  });
});

describe('Twelve Data: ao vivo por consulta', () => {
  it('fim de semana do forex: mercado fechado e nenhuma consulta gasta', async () => {
    const f = fakeFetch([]);
    const a = adapter(f, { now: () => SAT });
    const st: FeedStatus[] = [];
    const sub = a.subscribe('EURUSD', '1m', {
      onCandle: () => undefined,
      onStatus: (s) => st.push(s),
    });
    await vi.waitFor(() => expect(st[0]).toMatchObject({ state: 'market-closed' }));
    sub.close();
    expect(f.calls).toHaveLength(0);
  });

  it('emite o candle em formação e, quando muda o minuto, fecha o anterior', async () => {
    let step = 0;
    const pages = [
      series([
        ['2026-10-20 13:46:00', 1.0852],
        ['2026-10-20 13:45:00', 1.0851],
      ]),
      series([
        ['2026-10-20 13:47:00', 1.0855],
        ['2026-10-20 13:46:00', 1.0853],
      ]),
    ];
    const f = fakeFetch([{ match: () => true, body: undefined }]);
    const fetchFn = (async (u: string) => {
      f.calls.push(u);
      const body = pages[Math.min(step++, pages.length - 1)];
      return new Response(JSON.stringify(body));
    }) as typeof f;
    fetchFn.calls = f.calls;
    // relógio que anda (1 min por leitura): o limitador de 8 por minuto libera como no mundo real
    let t = TUE;
    const a = adapter(fetchFn, { pollMs: 5, now: () => (t += 60_000) });
    const ups: CandleUpdate[] = [];
    const st: FeedStatus[] = [];
    const sub = a.subscribe('EURUSD', '1m', {
      onCandle: (u) => ups.push(u),
      onStatus: (s) => st.push(s),
    });
    await vi.waitFor(() => expect(ups.length).toBeGreaterThanOrEqual(3));
    sub.close();
    expect(ups[0]).toMatchObject({ closed: false, candle: { close: 1.0852 } });
    // o minuto virou: o 13:46 fecha com o valor final e o 13:47 começa
    expect(ups[1]).toMatchObject({
      closed: true,
      candle: { time: Date.UTC(2026, 9, 20, 13, 46), close: 1.0853 },
    });
    expect(ups[2]).toMatchObject({ closed: false, candle: { close: 1.0855 } });
    expect(st[0]).toMatchObject({ state: 'ok' });
    expect(st[0]?.message).toMatch(/preço médio, sem volume/);
  });
});
