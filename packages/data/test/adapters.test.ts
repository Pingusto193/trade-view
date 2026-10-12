import type { Candle, FeedStatus } from '@radar/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AlpacaAdapter,
  BcbClient,
  BinanceAdapter,
  BrapiAdapter,
  LiveCandleBuilder,
  NotConfiguredError,
  SimulatedAdapter,
  TimeframeNotSupportedError,
  accumulateCdi,
  dailyToAnnual252,
  parseCotahist,
  parseCotahistLine,
  suspiciousGaps,
  type CandleUpdate,
} from '../src';
import { FakeWs, fakeFetch, fixture } from './helpers';

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe('Binance', () => {
  beforeEach(() => {
    FakeWs.instances = [];
  });

  it('lê klines REST com preços em string', async () => {
    const f = fakeFetch([{ match: (u) => u.includes('/api/v3/klines'), body: fixture('binance-klines.json') }]);
    const b = new BinanceAdapter({ fetch: f });
    const c = await b.getCandles({ symbol: 'BTCUSDT', tf: '1d', limit: 5 });
    expect(c).toHaveLength(5);
    expect(c[0]).toEqual({ time: D(2025, 10, 1), open: 60000, high: 60903, low: 59700, close: 60600, volume: 100 });
    expect(f.calls[0]).toContain('interval=1d');
    expect(f.calls[0]).toContain('data-api.binance.vision');
  });

  it('pagina de trás para frente quando pede mais de 1000 candles', async () => {
    const page = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => [start + i * 60_000, '1', '1', '1', '1', '1', 0]);
    let call = 0;
    const b = new BinanceAdapter({
      fetch: async () => {
        call++;
        const body = call === 1 ? page(1000 * 60_000, 1000) : page(500 * 60_000, 500);
        return new Response(JSON.stringify(body));
      },
    });
    const c = await b.getCandles({ symbol: 'BTCUSDT', tf: '1m', limit: 1500 });
    expect(c).toHaveLength(1500);
    expect(c[0]?.time).toBe(500 * 60_000);
    expect(call).toBe(2);
  });

  it('metadados: tick, lote e volume só da exchange', async () => {
    const f = fakeFetch([{ match: (u) => u.includes('exchangeInfo'), body: fixture('binance-exchangeinfo.json') }]);
    const m = await new BinanceAdapter({ fetch: f }).getMeta('BTCUSDT');
    expect(m).toMatchObject({ tickSize: 0.01, qtyStep: 0.00001, priceDecimals: 2, volume: 'exchange-only', currency: 'USD' });
  });

  it('WebSocket: candle em formação, fechado e reconexão', async () => {
    vi.useFakeTimers();
    const b = new BinanceAdapter({ wsFactory: (u) => new FakeWs(u) });
    const updates: CandleUpdate[] = [];
    const statuses: FeedStatus[] = [];
    let reconnects = 0;
    const sub = b.subscribe('BTCUSDT', '1m', {
      onCandle: (u) => updates.push(u),
      onStatus: (s) => statuses.push(s),
      onReconnect: () => reconnects++,
    });
    const ws = FakeWs.instances[0] as FakeWs;
    expect(ws.url).toBe('wss://data-stream.binance.vision:443/ws/btcusdt@kline_1m');
    ws.open();
    for (const m of fixture<unknown[]>('binance-ws-kline.json')) ws.emit(m);
    expect(updates.map((u) => u.closed)).toEqual([false, false, true, false]);
    expect(updates[2]?.candle.close).toBe(62040);

    ws.drop();
    expect(statuses.at(-1)?.state).toBe('error');
    await vi.advanceTimersByTimeAsync(5000);
    const ws2 = FakeWs.instances[1] as FakeWs;
    ws2.open();
    expect(reconnects).toBe(1);
    expect(statuses.at(-1)?.state).toBe('ok');
    sub.close();
    vi.useRealTimers();
  });
});

describe('Alpaca', () => {
  it('sem chave: erro claro de "não configurada"', async () => {
    const a = new AlpacaAdapter();
    expect(a.isConfigured()).toBe(false);
    await expect(a.getCandles({ symbol: 'AAPL', tf: '1d' })).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it('diário com paginação; datas convertidas para a data de pregão de Nova York; semanal agregado', async () => {
    const f = fakeFetch([
      { match: (u) => u.includes('page_token=PAGE2'), body: fixture('alpaca-bars-page2.json') },
      { match: (u) => u.includes('/v2/stocks/AAPL/bars'), body: fixture('alpaca-bars-page1.json') },
    ]);
    const a = new AlpacaAdapter({ keyId: 'k', secretKey: 's', fetch: f, now: () => D(2025, 10, 14) });
    const d = await a.getCandles({ symbol: 'AAPL', tf: '1d' });
    expect(d.map((c) => c.time)).toEqual([D(2025, 10, 6), D(2025, 10, 7), D(2025, 10, 8), D(2025, 10, 13)]);
    expect(f.calls[0]).toContain('feed=sip');
    expect(f.calls[0]).toContain('adjustment=all');
    const w = await a.getCandles({ symbol: 'AAPL', tf: '1w' });
    expect(w).toEqual([
      { time: D(2025, 10, 6), open: 100, high: 104, low: 99, close: 103, volume: 3_000_000 },
      { time: D(2025, 10, 13), open: 103, high: 105, low: 98, close: 99, volume: 1_500_000 },
    ]);
  });

  it('meta marca volume ao vivo como parcial', async () => {
    const m = await new AlpacaAdapter().getMeta('AAPL');
    expect(m.volume).toBe('complete');
    expect(m.liveVolume).toBe('partial');
  });
});

describe('brapi', () => {
  it('lê o histórico, ignora pontos nulos e usa a data de pregão de São Paulo', async () => {
    const f = fakeFetch([{ match: (u) => u.includes('/quote/PETR4'), body: fixture('brapi-quote-history.json') }]);
    const b = new BrapiAdapter({ token: 'tok', fetch: f });
    const d = await b.getCandles({ symbol: 'PETR4', tf: '1d' });
    expect(d.map((c) => c.time)).toEqual([D(2025, 10, 6), D(2025, 10, 7), D(2025, 10, 9), D(2025, 10, 13)]);
    expect(f.calls[0]).toContain('range=3mo');
    expect(f.calls[0]).toContain('token=tok');
    const w = await b.getCandles({ symbol: 'PETR4', tf: '1w' });
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ open: 30, high: 32, low: 29.5, close: 31.8, volume: 31_000_000 });
  });

  it('não oferece intradiário', async () => {
    await expect(new BrapiAdapter().getCandles({ symbol: 'PETR4', tf: '60m' })).rejects.toBeInstanceOf(
      TimeframeNotSupportedError,
    );
  });

  it('assinatura semanal não soma o volume do dia duas vezes entre consultas', async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2025, 9, 14, 15, 0); // terça, 12h em SP
    vi.setSystemTime(now);
    const f = fakeFetch([
      { match: (u) => u.includes('range='), body: fixture('brapi-quote-history.json') },
      { match: (u) => u.includes('/quote/PETR4'), body: fixture('brapi-quote-live.json') },
    ]);
    const b = new BrapiAdapter({ fetch: f, pollMs: 60_000, now: () => now });
    const ups: CandleUpdate[] = [];
    const sub = b.subscribe('PETR4', '1w', { onCandle: (u) => ups.push(u), onStatus: () => undefined });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(60_000);
    sub.close();
    vi.useRealTimers();
    const forming = ups.filter((u) => !u.closed);
    expect(forming.length).toBeGreaterThanOrEqual(2);
    // semana de 13/10: segunda (8 mi) + terça ao vivo (3 mi) = 11 mi, em todas as consultas
    for (const u of forming) {
      expect(u.candle.time).toBe(D(2025, 10, 13));
      expect(u.candle.volume).toBe(11_000_000);
      expect(u.candle.close).toBe(32.4);
    }
  });
});

describe('Banco Central (SGS)', () => {
  it('lê série e acumula o CDI', async () => {
    const f = fakeFetch([{ match: (u) => u.includes('bcdata.sgs.12'), body: fixture('bcb-sgs-12.json') }]);
    const bcb = new BcbClient({ fetch: f });
    const pts = await bcb.getSeries(12, D(2025, 10, 1), D(2025, 10, 3));
    expect(pts).toHaveLength(3);
    expect(f.calls[0]).toContain('dataInicial=01/10/2025&dataFinal=03/10/2025');
    expect(accumulateCdi(pts, D(2025, 10, 1), D(2025, 10, 3))).toBeCloseTo(1.00055131 ** 3, 12);
    expect(dailyToAnnual252(0.055131)).toBeCloseTo(14.9, 1);
  });

  it('divide consultas longas em janelas (limite de 10 anos do BCB)', async () => {
    const f = fakeFetch([{ match: () => true, body: [] }]);
    await new BcbClient({ fetch: f }).getSeries(12, D(2000, 1, 1), D(2025, 12, 31));
    expect(f.calls.length).toBe(3);
  });
});

describe('COTAHIST (B3)', () => {
  // Monta uma linha de 245 posições conforme o layout (posições 1-indexadas).
  function line(fields: Record<number, string>): string {
    const arr = Array.from({ length: 245 }, () => ' ');
    for (const [pos, val] of Object.entries(fields)) {
      for (let i = 0; i < val.length; i++) arr[Number(pos) - 1 + i] = val[i] as string;
    }
    return arr.join('');
  }
  const num = (v: number, w: number) => String(Math.round(v)).padStart(w, '0');
  const rec = (date: string, ticker: string, tpmerc: string, o: number, h: number, l: number, c: number) =>
    line({
      1: '01',
      3: date,
      11: '02',
      13: ticker.padEnd(12, ' '),
      25: tpmerc,
      28: 'PETROBRAS   ',
      57: num(o * 100, 13),
      70: num(h * 100, 13),
      83: num(l * 100, 13),
      109: num(c * 100, 13),
      148: num(12345, 5),
      153: num(5_000_000, 18),
      171: num(1.5e8 * 100, 18),
      211: num(1, 7),
    });

  it('lê uma linha de cotação', () => {
    const r = parseCotahistLine(rec('20251013', 'PETR4', '010', 31.8, 32.5, 31.5, 32));
    expect(r).toMatchObject({
      ticker: 'PETR4',
      date: D(2025, 10, 13),
      market: '010',
      candle: { open: 31.8, high: 32.5, low: 31.5, close: 32, volume: 5_000_000 },
      trades: 12345,
    });
  });

  it('filtra o mercado à vista (lote padrão) e ignora header/fracionário', () => {
    const text = [
      '00COTAHIST.2025BOVESPA 20251013'.padEnd(245, ' '),
      rec('20251014', 'PETR4', '010', 32, 33, 31, 32.5),
      rec('20251013', 'PETR4', '010', 31.8, 32.5, 31.5, 32),
      rec('20251013', 'PETR4F', '020', 31.8, 32.5, 31.5, 32),
    ].join('\n');
    const m = parseCotahist(text);
    expect([...m.keys()]).toEqual(['PETR4']);
    expect(m.get('PETR4')?.map((c) => c.time)).toEqual([D(2025, 10, 13), D(2025, 10, 14)]);
  });

  it('aponta gaps suspeitos (prováveis desdobramentos)', () => {
    const s: Candle[] = [
      { time: 1, open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { time: 2, open: 5, high: 5, low: 5, close: 5, volume: 1 },
    ];
    expect(suspiciousGaps(s)).toEqual([2]);
  });
});

describe('LiveCandleBuilder', () => {
  it('funde barras de 1 min em 5 min e fecha ao virar o período', () => {
    const out: CandleUpdate[] = [];
    const b = new LiveCandleBuilder('5m', 'UTC', (u) => out.push(u));
    const bar = (t: number, c: number, v = 1): Candle => ({ time: t * 60_000, open: c, high: c + 1, low: c - 1, close: c, volume: v });
    b.push(bar(0, 10));
    b.push(bar(1, 12));
    b.push(bar(5, 11));
    expect(out.map((u) => [u.candle.time, u.closed, u.candle.close, u.candle.volume])).toEqual([
      [0, false, 10, 1],
      [0, false, 12, 2],
      [0, true, 12, 2],
      [300_000, false, 11, 1],
    ]);
  });
});

describe('Simulador (DEV)', () => {
  afterEach(() => vi.useRealTimers());
  it('é determinístico e marcado como simulado', async () => {
    const now = Date.UTC(2026, 9, 12, 12);
    const s = new SimulatedAdapter(() => now);
    const a = await s.getCandles({ symbol: 'SIMBTC', tf: '1d', limit: 50 });
    const b = await s.getCandles({ symbol: 'SIMBTC', tf: '1d', limit: 50 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(50);
    expect((await s.getMeta('SIMBTC')).delay.kind).toBe('simulated');
  });
});
