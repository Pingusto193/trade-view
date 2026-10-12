import type { Candle, SymbolMeta, SymbolSearchResult, Timeframe } from '@radar/shared';
import { aggregate, isIntradayTf, sessionDate } from '../util';
import { HttpClient, type FetchFn } from '../http';
import { LiveCandleBuilder } from '../live';
import {
  NotConfiguredError,
  symbolId,
  type CandleRequest,
  type CandleUpdate,
  type MarketDataAdapter,
  type SubscribeHandlers,
  type Subscription,
} from '../types';
import { ReconnectingWs, type WsFactory } from '../ws';

/**
 * Alpaca — ações dos EUA (plano gratuito). Ver docs/DATA_SOURCES.md §2.
 * - Histórico: barras consolidadas (SIP) até 15 minutos atrás (volume completo).
 * - Tempo real: só o feed IEX, uma fração do mercado → **volume ao vivo parcial**.
 * - Semanal e mensal: montados a partir do diário (ADR-0006), não pedidos à fonte.
 */
const TZ = 'America/New_York';
const SIP_DELAY_MS = 16 * 60_000; // 15 min + folga

const ALPACA_TF: Readonly<Record<'1m' | '5m' | '15m' | '30m' | '60m' | '1d', string>> = {
  '1m': '1Min',
  '5m': '5Min',
  '15m': '15Min',
  '30m': '30Min',
  '60m': '1Hour',
  '1d': '1Day',
};

export interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface BarsResponse {
  bars: AlpacaBar[] | null;
  next_page_token?: string | null;
}

export function parseAlpacaBar(b: AlpacaBar, daily: boolean): Candle {
  const t = Date.parse(b.t);
  return {
    time: daily ? sessionDate(t, TZ) : t,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  };
}

const POPULAR: readonly [string, string][] = [
  ['AAPL', 'Apple'],
  ['MSFT', 'Microsoft'],
  ['NVDA', 'NVIDIA'],
  ['AMZN', 'Amazon'],
  ['GOOGL', 'Alphabet'],
  ['META', 'Meta Platforms'],
  ['TSLA', 'Tesla'],
  ['NFLX', 'Netflix'],
  ['PLTR', 'Palantir'],
  ['APP', 'AppLovin'],
  ['SPY', 'SPDR S&P 500 ETF'],
  ['QQQ', 'Invesco QQQ (Nasdaq-100)'],
];

export interface AlpacaOptions {
  keyId?: string;
  secretKey?: string;
  restBase?: string;
  wsUrl?: string;
  fetch?: FetchFn;
  wsFactory?: WsFactory;
  now?: () => number;
}

export class AlpacaAdapter implements MarketDataAdapter {
  readonly id = 'alpaca';
  readonly label = 'Alpaca';
  readonly market = 'us' as const;
  private readonly http: HttpClient;
  private readonly restBase: string;
  private readonly now: () => number;
  // Uma única conexão WS para todos os símbolos (o plano gratuito limita conexões simultâneas).
  private ws: ReconnectingWs | null = null;
  private readonly listeners = new Map<string, Set<(bar: Candle) => void>>();
  private readonly statusListeners = new Set<SubscribeHandlers>();

  constructor(private readonly opts: AlpacaOptions = {}) {
    this.restBase = opts.restBase ?? 'https://data.alpaca.markets';
    this.now = opts.now ?? Date.now;
    this.http = new HttpClient({
      source: this.label,
      maxRequests: 180, // limite oficial: 200/min no plano gratuito
      perMs: 60_000,
      headers: {
        'APCA-API-KEY-ID': opts.keyId ?? '',
        'APCA-API-SECRET-KEY': opts.secretKey ?? '',
      },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  isConfigured(): boolean {
    return Boolean(this.opts.keyId && this.opts.secretKey);
  }

  private requireConfig(): void {
    if (!this.isConfigured()) {
      throw new NotConfiguredError(this.label, 'defina ALPACA_KEY_ID e ALPACA_SECRET_KEY no .env');
    }
  }

  async searchSymbols(text: string): Promise<SymbolSearchResult[]> {
    const q = text.trim().toUpperCase();
    const hits = POPULAR.filter(([s, n]) => s.includes(q) || n.toUpperCase().includes(q));
    const res = hits.map(([s, n]) => ({
      id: symbolId(this.id, s),
      symbol: s,
      name: n,
      market: this.market,
      sourceLabel: this.label,
    }));
    // Código exato digitado (ex.: "KO") é oferecido mesmo fora da lista.
    if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(q) && !res.some((r) => r.symbol === q)) {
      res.push({
        id: symbolId(this.id, q),
        symbol: q,
        name: `${q} (código digitado)`,
        market: this.market,
        sourceLabel: this.label,
      });
    }
    return res;
  }

  async getMeta(symbol: string): Promise<SymbolMeta> {
    const name = POPULAR.find(([s]) => s === symbol)?.[1] ?? symbol;
    return {
      id: symbolId(this.id, symbol),
      symbol,
      name,
      market: this.market,
      source: this.id,
      sourceLabel: this.label,
      currency: 'USD',
      tickSize: 0.01,
      lotSize: 1,
      minQty: 1,
      qtyStep: 1,
      priceDecimals: 2,
      pointValue: 1,
      delay: { kind: 'delayed', minutes: 15 },
      volume: 'complete',
      liveVolume: 'partial',
      session: {
        timezone: TZ,
        days: [1, 2, 3, 4, 5],
        preOpen: '04:00',
        open: '09:30',
        close: '16:00',
      },
      timeframes: ['1m', '5m', '15m', '30m', '60m', '1d', '1w', '1M'],
      adjusted: 'yes',
      notes: [
        'Histórico consolidado (SIP) com atraso de 15 min no plano gratuito.',
        'Atualizações ao vivo vêm só da bolsa IEX: o volume do candle em formação é PARCIAL.',
        'Feriados dos EUA não estão cadastrados: o estado "aberto" pode estar errado nesses dias.',
      ],
    };
  }

  private async fetchBars(
    symbol: string,
    tf: keyof typeof ALPACA_TF,
    from: number,
    to: number,
    feed: 'sip' | 'iex',
  ): Promise<Candle[]> {
    this.requireConfig();
    const out: Candle[] = [];
    let token: string | null | undefined;
    const daily = tf === '1d';
    for (let guard = 0; guard < 100; guard++) {
      const p = new URLSearchParams({
        timeframe: ALPACA_TF[tf],
        start: new Date(from).toISOString(),
        end: new Date(to).toISOString(),
        limit: '10000',
        adjustment: 'all',
        feed,
      });
      if (token) p.set('page_token', token);
      const r = await this.http.getJson<BarsResponse>(
        `${this.restBase}/v2/stocks/${encodeURIComponent(symbol)}/bars?${p.toString()}`,
      );
      for (const b of r.bars ?? []) out.push(parseAlpacaBar(b, daily));
      token = r.next_page_token;
      if (!token) break;
    }
    return out;
  }

  async getCandles(req: CandleRequest): Promise<Candle[]> {
    const now = this.now();
    const to = Math.min(req.to ?? now, now - SIP_DELAY_MS);
    const base: keyof typeof ALPACA_TF = isIntradayTf(req.tf)
      ? (req.tf as keyof typeof ALPACA_TF)
      : '1d';
    const want = req.limit ?? 1500;
    const spanMs: Record<keyof typeof ALPACA_TF, number> = {
      '1m': 7 * 86_400_000,
      '5m': 30 * 86_400_000,
      '15m': 90 * 86_400_000,
      '30m': 180 * 86_400_000,
      '60m': 365 * 86_400_000,
      '1d': 12 * 365 * 86_400_000,
    };
    const from =
      req.from ?? to - (req.tf === '1w' || req.tf === '1M' ? 25 * 365 * 86_400_000 : spanMs[base]);
    const bars = await this.fetchBars(req.symbol, base, from, to, 'sip');
    const candles = base === req.tf ? bars : aggregate(bars, '1d', req.tf, TZ);
    return candles.slice(-want);
  }

  subscribe(symbol: string, tf: Timeframe, h: SubscribeHandlers): Subscription {
    if (!this.isConfigured()) {
      h.onStatus({
        state: 'not-configured',
        message: 'Alpaca sem chave: defina ALPACA_KEY_ID e ALPACA_SECRET_KEY',
      });
      return { close: () => undefined };
    }
    const builder = new LiveCandleBuilder(tf, TZ, (u: CandleUpdate) => h.onCandle(u));
    let ready = false;
    const pending: Candle[] = [];
    // Semente: o candle do período atual = histórico SIP + barras IEX dos últimos minutos.
    void (async () => {
      try {
        const hist = await this.getCandles({ symbol, tf, limit: 1 });
        const last = hist[hist.length - 1] ?? null;
        builder.seed(last);
        const from = this.now() - SIP_DELAY_MS;
        const recent = await this.fetchBars(symbol, '1m', from, this.now(), 'iex');
        for (const b of recent) builder.push(b);
      } catch (err) {
        h.onStatus({ state: 'error', message: (err as Error).message });
      }
      ready = true;
      for (const b of pending.splice(0)) builder.push(b);
    })();

    const onBar = (bar: Candle) => (ready ? builder.push(bar) : pending.push(bar));
    let set = this.listeners.get(symbol);
    if (!set) {
      set = new Set();
      this.listeners.set(symbol, set);
      this.sendSubscription('subscribe', symbol);
    }
    set.add(onBar);
    this.statusListeners.add(h);
    this.ensureWs();
    return {
      close: () => {
        set?.delete(onBar);
        this.statusListeners.delete(h);
        if (set && set.size === 0) {
          this.listeners.delete(symbol);
          this.sendSubscription('unsubscribe', symbol);
        }
        if (this.listeners.size === 0) {
          this.ws?.close();
          this.ws = null;
        }
      },
    };
  }

  private sendSubscription(action: 'subscribe' | 'unsubscribe', symbol: string): void {
    this.ws?.send(JSON.stringify({ action, bars: [symbol], updatedBars: [symbol] }));
  }

  private broadcastStatus(s: Parameters<SubscribeHandlers['onStatus']>[0]): void {
    for (const h of this.statusListeners) h.onStatus(s);
  }

  private ensureWs(): void {
    if (this.ws) return;
    this.ws = new ReconnectingWs({
      url: this.opts.wsUrl ?? 'wss://stream.data.alpaca.markets/v2/iex',
      ...(this.opts.wsFactory ? { factory: this.opts.wsFactory } : {}),
      onOpen: (ws, reconnected) => {
        ws.send(
          JSON.stringify({ action: 'auth', key: this.opts.keyId, secret: this.opts.secretKey }),
        );
        if (reconnected) for (const h of this.statusListeners) h.onReconnect?.();
      },
      onMessage: (data) => {
        let arr: unknown;
        try {
          arr = JSON.parse(data);
        } catch {
          return;
        }
        if (!Array.isArray(arr)) return;
        for (const m of arr as Record<string, unknown>[]) {
          if (m.T === 'success' && m.msg === 'authenticated') {
            const symbols = [...this.listeners.keys()];
            if (symbols.length) {
              this.ws?.send(
                JSON.stringify({ action: 'subscribe', bars: symbols, updatedBars: symbols }),
              );
            }
            this.broadcastStatus({ state: 'ok', message: 'Ao vivo via IEX (volume parcial)' });
          } else if (m.T === 'error') {
            this.broadcastStatus({
              state: 'error',
              message: `Alpaca: ${String(m.msg)} (código ${String(m.code)})`,
            });
          } else if ((m.T === 'b' || m.T === 'u') && typeof m.S === 'string') {
            const bar = parseAlpacaBar(m as unknown as AlpacaBar, false);
            for (const fn of this.listeners.get(m.S) ?? []) fn(bar);
          }
        }
      },
      onDown: (reason) =>
        this.broadcastStatus({
          state: 'error',
          message: `Conexão com a Alpaca caiu (${reason}); reconectando…`,
        }),
    });
  }
}
