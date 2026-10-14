import type { Candle, SymbolMeta, SymbolSearchResult, Timeframe } from '@radar/shared';
import type { BcbClient, CvmClient, SecEdgarClient } from '@radar/data';
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
import type { Senders } from '../src/notify/notifier';

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
  /** Troca campos dos metadados (ex.: mercado 'us' ou 'b3' para os testes de fundamentos). */
  metaPatch: Partial<SymbolMeta> = {};

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
      ...this.metaPatch,
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

/** Canais de notificação falsos: guardam o que seria enviado. */
export class FakeSenders {
  push: { endpoint: string; payload: string }[] = [];
  telegram: { chatId: string; text: string }[] = [];
  email: { to: string; subject: string; text: string }[] = [];
  /** Endpoints que o "serviço de push" diz que não existem mais (410). */
  gone = new Set<string>();
  readonly senders: Senders = {
    push: {
      send: async (t, payload) => {
        if (this.gone.has(t.endpoint)) return { ok: false, gone: true, message: '410' };
        this.push.push({ endpoint: t.endpoint, payload });
        return { ok: true };
      },
    },
    telegram: {
      send: async (_token, chatId, text) => void this.telegram.push({ chatId, text }),
      detectChat: async () => ({ chatId: '4242', name: 'Teste' }),
    },
    email: {
      available: true,
      send: async (to, subject, text) => void this.email.push({ to, subject, text }),
    },
  };
}

export async function testApp(
  opts: {
    now?: number | (() => number);
    auth?: boolean;
    senders?: FakeSenders;
    bcb?: BcbClient;
    /** Liga RADAR_SIMULATED (aceita o simulador do agente MT5). */
    simulated?: boolean;
    sec?: SecEdgarClient;
    cvm?: CvmClient;
  } = {},
) {
  const fake = new FakeAdapter();
  const env = envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    RADAR_DEV_NO_AUTH: opts.auth ? '0' : '1',
    PUBLIC_URL: 'http://localhost:5173',
    ...(opts.simulated ? { RADAR_SIMULATED: '1' } : {}),
  });
  const db = openDb(':memory:');
  const registry = new AdapterRegistry([fake]);
  const radar = await buildApp({
    env,
    db,
    registry,
    logger: false,
    ...(opts.senders ? { senders: opts.senders.senders } : {}),
    ...(opts.bcb ? { bcb: opts.bcb } : {}),
    ...(opts.sec ? { sec: opts.sec } : {}),
    ...(opts.cvm ? { cvm: opts.cvm } : {}),
    ...(opts.now !== undefined
      ? { now: typeof opts.now === 'function' ? opts.now : () => opts.now as number }
      : {}),
  });
  return { ...radar, fake, db };
}
