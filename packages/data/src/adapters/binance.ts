import type {
  Candle,
  SymbolMeta,
  SymbolSearchResult,
  Timeframe,
} from '@radar/shared';
import { HttpClient, type FetchFn } from '../http';
import {
  DataSourceError,
  SymbolNotFoundError,
  symbolId,
  type CandleRequest,
  type MarketDataAdapter,
  type SubscribeHandlers,
  type Subscription,
} from '../types';
import { ReconnectingWs, type WsFactory } from '../ws';

/**
 * Binance Spot — somente dados públicos de mercado (sem chave).
 * Endpoints verificados em docs/DATA_SOURCES.md §1:
 *   REST: https://data-api.binance.vision/api/v3/klines
 *   WS:   wss://data-stream.binance.vision:443/ws/<símbolo>@kline_<intervalo>
 *
 * Convenção de tempo: os klines diários/semanais/mensais da Binance abrem às 00:00 UTC
 * (semana na segunda, mês no dia 1), exatamente a convenção do Radar (ADR-0006).
 * O volume é **só da Binance**, não do mercado cripto inteiro.
 */
export const BINANCE_INTERVAL: Readonly<Record<Timeframe, string>> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '60m': '1h',
  '1d': '1d',
  '1w': '1w',
  '1M': '1M',
};

/** Linha de kline REST: [openTime, o, h, l, c, v, closeTime, quoteVol, trades, takerBase, takerQuote, ignore]. */
export type BinanceKlineRow = [number, string, string, string, string, string, number, ...unknown[]];

export interface BinanceWsKline {
  e: 'kline';
  E: number;
  s: string;
  k: {
    t: number;
    T: number;
    s: string;
    i: string;
    o: string;
    c: string;
    h: string;
    l: string;
    v: string;
    x: boolean;
  };
}

interface ExchangeInfo {
  symbols: {
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    filters: { filterType: string; tickSize?: string; stepSize?: string; minQty?: string }[];
  }[];
}

export function parseRestKline(row: BinanceKlineRow): Candle {
  return {
    time: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

export function parseWsKline(msg: BinanceWsKline): { candle: Candle; closed: boolean } {
  const k = msg.k;
  return {
    candle: {
      time: k.t,
      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c),
      volume: Number(k.v),
    },
    closed: k.x,
  };
}

function decimalsOf(step: string): number {
  const n = Number(step);
  if (!Number.isFinite(n) || n <= 0) return 2;
  const s = step.replace(/0+$/, '');
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Pares mais líquidos, usados na busca sem precisar baixar o exchangeInfo inteiro. */
const POPULAR: readonly [string, string][] = [
  ['BTCUSDT', 'Bitcoin / Tether'],
  ['ETHUSDT', 'Ethereum / Tether'],
  ['SOLUSDT', 'Solana / Tether'],
  ['BNBUSDT', 'BNB / Tether'],
  ['XRPUSDT', 'XRP / Tether'],
  ['ADAUSDT', 'Cardano / Tether'],
  ['DOGEUSDT', 'Dogecoin / Tether'],
  ['AVAXUSDT', 'Avalanche / Tether'],
  ['LINKUSDT', 'Chainlink / Tether'],
  ['DOTUSDT', 'Polkadot / Tether'],
  ['LTCUSDT', 'Litecoin / Tether'],
  ['BTCBRL', 'Bitcoin / Real'],
  ['ETHBRL', 'Ethereum / Real'],
  ['USDTBRL', 'Tether / Real'],
];

export interface BinanceOptions {
  restBase?: string;
  wsBase?: string;
  fetch?: FetchFn;
  wsFactory?: WsFactory;
}

export class BinanceAdapter implements MarketDataAdapter {
  readonly id = 'binance';
  readonly label = 'Binance';
  readonly market = 'crypto' as const;
  private readonly http: HttpClient;
  private readonly restBase: string;
  private readonly wsBase: string;
  private readonly metaCache = new Map<string, SymbolMeta>();

  constructor(private readonly opts: BinanceOptions = {}) {
    this.restBase = opts.restBase ?? 'https://data-api.binance.vision';
    this.wsBase = opts.wsBase ?? 'wss://data-stream.binance.vision:443';
    // Limite conservador (o limite real é por "peso"; ver DATA_SOURCES.md — NÃO VERIFICADO).
    this.http = new HttpClient({
      source: this.label,
      maxRequests: 10,
      perMs: 1000,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  isConfigured(): boolean {
    return true; // dados públicos, sem chave
  }

  async searchSymbols(text: string): Promise<SymbolSearchResult[]> {
    const q = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const hits = POPULAR.filter(([s, n]) => s.includes(q) || n.toUpperCase().includes(q));
    return hits.map(([s, n]) => ({
      id: symbolId(this.id, s),
      symbol: s,
      name: n,
      market: this.market,
      sourceLabel: this.label,
    }));
  }

  async getMeta(symbol: string): Promise<SymbolMeta> {
    const cached = this.metaCache.get(symbol);
    if (cached) return cached;
    const info = await this.http.getJson<ExchangeInfo>(
      `${this.restBase}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`,
    );
    const s = info.symbols.find((x) => x.symbol === symbol);
    if (!s) throw new SymbolNotFoundError(this.label, symbol);
    const price = s.filters.find((f) => f.filterType === 'PRICE_FILTER');
    const lot = s.filters.find((f) => f.filterType === 'LOT_SIZE');
    const tick = Number(price?.tickSize ?? '0.01');
    const step = Number(lot?.stepSize ?? '0.00001');
    const meta: SymbolMeta = {
      id: symbolId(this.id, symbol),
      symbol,
      name: `${s.baseAsset} / ${s.quoteAsset}`,
      market: this.market,
      source: this.id,
      sourceLabel: this.label,
      currency: s.quoteAsset === 'BRL' ? 'BRL' : s.quoteAsset === 'USDT' || s.quoteAsset === 'USDC' ? 'USD' : s.quoteAsset,
      tickSize: tick,
      lotSize: step,
      minQty: Number(lot?.minQty ?? step),
      qtyStep: step,
      priceDecimals: decimalsOf(price?.tickSize ?? '0.01'),
      pointValue: 1,
      delay: { kind: 'realtime' },
      volume: 'exchange-only',
      liveVolume: 'exchange-only',
      session: { timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6] },
      timeframes: ['1m', '5m', '15m', '30m', '60m', '1d', '1w', '1M'],
      adjusted: 'yes', // cripto não tem proventos/desdobramentos
      notes: [
        'Volume apenas da Binance, não do mercado cripto inteiro.',
        s.quoteAsset.startsWith('USD') ? 'Cotado em USDT (≈ dólar), não em reais.' : '',
      ].filter(Boolean),
    };
    this.metaCache.set(symbol, meta);
    return meta;
  }

  async getCandles(req: CandleRequest): Promise<Candle[]> {
    const interval = BINANCE_INTERVAL[req.tf];
    const want = req.limit ?? 1000;
    const out: Candle[] = [];
    // Pagina de trás para frente (mais recentes primeiro), até 1000 por chamada.
    let endTime = req.to;
    for (let guard = 0; guard < 50 && out.length < want; guard++) {
      const lim = Math.min(1000, want - out.length);
      const params = new URLSearchParams({ symbol: req.symbol, interval, limit: String(lim) });
      if (endTime !== undefined) params.set('endTime', String(endTime));
      if (req.from !== undefined) params.set('startTime', String(req.from));
      const rows = await this.http.getJson<BinanceKlineRow[]>(
        `${this.restBase}/api/v3/klines?${params.toString()}`,
      );
      if (!Array.isArray(rows)) throw new DataSourceError('resposta inesperada de klines', this.label);
      const batch = rows.map(parseRestKline);
      out.unshift(...batch);
      if (rows.length < lim || req.from !== undefined) break;
      const first = batch[0];
      if (!first) break;
      endTime = first.time - 1;
    }
    // remove duplicados nas emendas
    const seen = new Set<number>();
    return out.filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true))).slice(-want);
  }

  subscribe(symbol: string, tf: Timeframe, h: SubscribeHandlers): Subscription {
    const stream = `${symbol.toLowerCase()}@kline_${BINANCE_INTERVAL[tf]}`;
    h.onStatus({ state: 'connecting' });
    let lastValidAt: number | undefined;
    const ws = new ReconnectingWs({
      url: `${this.wsBase}/ws/${stream}`,
      ...(this.opts.wsFactory ? { factory: this.opts.wsFactory } : {}),
      maxLifetimeMs: 23 * 3600_000, // renova antes do limite de 24 h
      staleAfterMs: 90_000,
      onOpen: (_ws, reconnected) => {
        h.onStatus({ state: 'ok', ...(lastValidAt ? { lastValidAt } : {}) });
        if (reconnected) h.onReconnect?.();
      },
      onMessage: (data) => {
        let msg: unknown;
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }
        if ((msg as BinanceWsKline)?.e !== 'kline') return;
        const u = parseWsKline(msg as BinanceWsKline);
        lastValidAt = Date.now();
        h.onCandle(u);
      },
      onDown: (reason) =>
        h.onStatus({
          state: 'error',
          message: `Conexão com a Binance caiu (${reason}); reconectando…`,
          ...(lastValidAt ? { lastValidAt } : {}),
        }),
      onStale: () =>
        h.onStatus({
          state: 'stale',
          message: 'Sem mensagens da Binance há mais de 90 s',
          ...(lastValidAt ? { lastValidAt } : {}),
        }),
    });
    return { close: () => ws.close() };
  }
}
