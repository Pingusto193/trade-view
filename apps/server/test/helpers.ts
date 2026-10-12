import type { Candle, SymbolMeta, SymbolSearchResult, Timeframe } from '@radar/shared';
import {
  AdapterRegistry,
  DataSourceError,
  type CandleRequest,
  type MarketDataAdapter,
  type SubscribeHandlers,
  type Subscription,
} from '@radar/data';
import { buildApp } from '../src/app';
import { openDb } from '../src/db/client';
import { envSchema } from '../src/env';

/** Fonte falsa controlada pelo teste. */
export class FakeAdapter implements MarketDataAdapter {
  readonly id = 'fake';
  readonly label = 'Fonte de teste';
  readonly market = 'crypto' as const;
  candles: Candle[] = [];
  fail: string | null = null;
  calls = 0;
  handlers: SubscribeHandlers[] = [];
  closed = 0;

  isConfigured() {
    return true;
  }
  async searchSymbols(q: string): Promise<SymbolSearchResult[]> {
    return q
      ? [
          {
            id: 'fake:AAA',
            symbol: 'AAA',
            name: 'Ativo de teste',
            market: 'crypto',
            sourceLabel: this.label,
          },
        ]
      : [];
  }
  async getMeta(symbol: string): Promise<SymbolMeta> {
    return {
      id: `fake:${symbol}`,
      symbol,
      name: 'Ativo de teste',
      market: 'crypto',
      source: 'fake',
      sourceLabel: this.label,
      currency: 'USD',
      tickSize: 0.01,
      lotSize: 1,
      minQty: 1,
      qtyStep: 1,
      priceDecimals: 2,
      pointValue: 1,
      delay: { kind: 'realtime' },
      volume: 'complete',
      liveVolume: 'complete',
      session: { timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6] },
      timeframes: ['1m', '1d'],
      adjusted: 'yes',
      notes: [],
    };
  }
  async getCandles(req: CandleRequest): Promise<Candle[]> {
    this.calls++;
    if (this.fail) throw new DataSourceError(this.fail, this.label);
    return this.candles.slice(-(req.limit ?? 1000));
  }
  subscribe(_s: string, _tf: Timeframe, h: SubscribeHandlers): Subscription {
    this.handlers.push(h);
    h.onStatus({ state: 'ok' });
    return { close: () => void this.closed++ };
  }
}

export const DAY = 86_400_000;

export function series(n: number, start = 0): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * DAY,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 10,
  }));
}

export async function testApp(opts: { now?: number } = {}) {
  const fake = new FakeAdapter();
  const env = envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    RADAR_DEV_NO_AUTH: '1',
  });
  const db = openDb(':memory:');
  const registry = new AdapterRegistry([fake]);
  const radar = await buildApp({
    env,
    db,
    registry,
    logger: false,
    ...(opts.now !== undefined ? { now: () => opts.now as number } : {}),
  });
  return { ...radar, fake, db };
}
