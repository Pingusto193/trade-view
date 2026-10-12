import type { Candle, SymbolMeta, SymbolSearchResult, Timeframe } from '@radar/shared';
import { marketState, upsertCandle } from '@radar/core';
import { HttpClient, type FetchFn } from '../http';
import {
  DataSourceError,
  SymbolNotFoundError,
  TimeframeNotSupportedError,
  symbolId,
  type CandleRequest,
  type MarketDataAdapter,
  type SubscribeHandlers,
  type Subscription,
} from '../types';
import { aggregate, sessionDate } from '../util';
import { B3_EQUITY_SESSION } from './b3-calendar';

/**
 * brapi.dev — B3 com atraso. Ver docs/DATA_SOURCES.md §3.
 * Plano gratuito (🟡 fonte: FAQ da brapi): ~30 min de atraso, 15.000 requisições/mês,
 * **só 3 meses de histórico**. Por isso o servidor complementa com o COTAHIST da B3 quando
 * importado. Intradiário não é oferecido por este adaptador.
 *
 * 🔌 Formato da resposta lido em exemplos da documentação; nenhuma chamada real feita daqui.
 */
const TZ = 'America/Sao_Paulo';

export interface BrapiHistoricalPoint {
  date: number; // unix (segundos)
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjustedClose?: number | null;
}

export interface BrapiQuoteResult {
  symbol: string;
  shortName?: string;
  longName?: string;
  currency?: string;
  regularMarketPrice?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  regularMarketTime?: string;
  historicalDataPrice?: BrapiHistoricalPoint[];
}

interface BrapiQuoteResponse {
  results?: BrapiQuoteResult[];
  error?: boolean;
  message?: string;
}

export function parseBrapiHistory(points: readonly BrapiHistoricalPoint[]): Candle[] {
  const out: Candle[] = [];
  for (const p of points) {
    if (p.open == null || p.high == null || p.low == null || p.close == null) continue;
    out.push({
      time: sessionDate(p.date * 1000, TZ),
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume ?? 0,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Ações líquidas do Ibovespa para a busca offline (o usuário também pode digitar qualquer código). */
export const B3_POPULAR: readonly [string, string][] = [
  ['PETR4', 'Petrobras PN'],
  ['VALE3', 'Vale ON'],
  ['ITUB4', 'Itaú Unibanco PN'],
  ['BBDC4', 'Bradesco PN'],
  ['BBAS3', 'Banco do Brasil ON'],
  ['ABEV3', 'Ambev ON'],
  ['WEGE3', 'WEG ON'],
  ['B3SA3', 'B3 ON'],
  ['PRIO3', 'PRIO ON'],
  ['SUZB3', 'Suzano ON'],
  ['RENT3', 'Localiza ON'],
  ['ELET3', 'Eletrobras ON'],
  ['GGBR4', 'Gerdau PN'],
  ['RADL3', 'Raia Drogasil ON'],
  ['EQTL3', 'Equatorial ON'],
  ['RDOR3', "Rede D'Or ON"],
  ['BPAC11', 'BTG Pactual Unit'],
  ['ITSA4', 'Itaúsa PN'],
  ['VBBR3', 'Vibra ON'],
  ['JBSS3', 'JBS ON'],
  ['BOVA11', 'iShares Ibovespa (ETF)'],
];

export interface BrapiOptions {
  token?: string;
  base?: string;
  fetch?: FetchFn;
  /** Intervalo de consulta da cotação atual (padrão: 5 min, para caber na cota gratuita). */
  pollMs?: number;
  now?: () => number;
  /** Histórico máximo do plano ("3mo" no gratuito). */
  maxRange?: '3mo' | '1y' | '5y' | 'max';
}

export class BrapiAdapter implements MarketDataAdapter {
  readonly id = 'brapi';
  readonly label = 'brapi.dev';
  readonly market = 'b3' as const;
  private readonly http: HttpClient;
  private readonly base: string;
  private readonly now: () => number;

  constructor(private readonly opts: BrapiOptions = {}) {
    this.base = opts.base ?? 'https://brapi.dev/api';
    this.now = opts.now ?? Date.now;
    // 15.000/mês ≈ 20/hora em média; limitamos rajadas a 30/min.
    this.http = new HttpClient({
      source: this.label,
      maxRequests: 30,
      perMs: 60_000,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  isConfigured(): boolean {
    return Boolean(this.opts.token);
  }

  private url(path: string, params: Record<string, string>): string {
    const p = new URLSearchParams(params);
    if (this.opts.token) p.set('token', this.opts.token);
    return `${this.base}${path}?${p.toString()}`;
  }

  async searchSymbols(text: string): Promise<SymbolSearchResult[]> {
    const q = text.trim().toUpperCase();
    const res = B3_POPULAR.filter(([s, n]) => s.includes(q) || n.toUpperCase().includes(q)).map(
      ([s, n]) => ({
        id: symbolId(this.id, s),
        symbol: s,
        name: n,
        market: this.market,
        sourceLabel: this.label,
      }),
    );
    if (/^[A-Z]{4}\d{1,2}$/.test(q) && !res.some((r) => r.symbol === q)) {
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
    const name = B3_POPULAR.find(([s]) => s === symbol)?.[1] ?? symbol;
    return {
      id: symbolId(this.id, symbol),
      symbol,
      name,
      market: this.market,
      source: this.id,
      sourceLabel: this.label,
      currency: 'BRL',
      tickSize: 0.01,
      lotSize: 100,
      minQty: 1,
      qtyStep: 1,
      priceDecimals: 2,
      pointValue: 1,
      delay: { kind: 'delayed', minutes: 30 },
      volume: 'complete',
      liveVolume: 'complete',
      session: B3_EQUITY_SESSION,
      timeframes: ['1d', '1w', '1M'],
      adjusted: 'unknown',
      notes: [
        'Plano gratuito da brapi: cotação com ~30 min de atraso e só 3 meses de histórico.',
        'Para histórico longo, importe o COTAHIST da B3 (não ajustado por proventos).',
        'Horário e feriados da B3 não verificados na fonte oficial.',
      ],
    };
  }

  async getCandles(req: CandleRequest): Promise<Candle[]> {
    if (req.tf !== '1d' && req.tf !== '1w' && req.tf !== '1M') {
      throw new TimeframeNotSupportedError(this.label, req.tf);
    }
    const r = await this.http.getJson<BrapiQuoteResponse>(
      this.url(`/quote/${encodeURIComponent(req.symbol)}`, {
        range: this.opts.maxRange ?? '3mo',
        interval: '1d',
      }),
    );
    if (r.error) throw new DataSourceError(r.message ?? 'erro da brapi', this.label);
    const res = r.results?.[0];
    if (!res) throw new SymbolNotFoundError(this.label, req.symbol);
    let candles = parseBrapiHistory(res.historicalDataPrice ?? []);
    if (req.from !== undefined) candles = candles.filter((c) => c.time >= (req.from as number));
    if (req.to !== undefined) candles = candles.filter((c) => c.time <= (req.to as number));
    if (req.tf !== '1d') candles = aggregate(candles, '1d', req.tf, TZ);
    return req.limit ? candles.slice(-req.limit) : candles;
  }

  /** Cotação atual como candle diário em formação (volume acumulado do dia). */
  async getLiveDaily(symbol: string): Promise<Candle | null> {
    const r = await this.http.getJson<BrapiQuoteResponse>(
      this.url(`/quote/${encodeURIComponent(symbol)}`, {}),
    );
    const q = r.results?.[0];
    if (!q || q.regularMarketPrice == null) return null;
    const t = q.regularMarketTime ? Date.parse(q.regularMarketTime) : this.now();
    const price = q.regularMarketPrice;
    return {
      time: sessionDate(t, TZ),
      open: q.regularMarketOpen ?? price,
      high: q.regularMarketDayHigh ?? price,
      low: q.regularMarketDayLow ?? price,
      close: price,
      volume: q.regularMarketVolume ?? 0,
    };
  }

  subscribe(symbol: string, tf: Timeframe, h: SubscribeHandlers): Subscription {
    if (tf !== '1d' && tf !== '1w' && tf !== '1M') {
      h.onStatus({ state: 'error', message: `brapi não oferece a escala ${tf}` });
      return { close: () => undefined };
    }
    // O diário é mantido localmente: histórico + cotação atual (que substitui o dia de hoje).
    // Semanal/mensal são reagregados a cada consulta, para não somar o volume do dia duas vezes.
    let daily: Candle[] | null = null;
    let lastEmitted: Candle | null = null;
    let lastValidAt: number | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const tick = async () => {
      if (closed) return;
      const state = marketState(B3_EQUITY_SESSION, this.now());
      if (state === 'closed' && daily) {
        h.onStatus({ state: 'market-closed', ...(lastValidAt ? { lastValidAt } : {}) });
      } else {
        try {
          if (!daily) daily = await this.getCandles({ symbol, tf: '1d' });
          const live = await this.getLiveDaily(symbol);
          if (live) {
            upsertCandle(daily, live);
            lastValidAt = this.now();
            const series = tf === '1d' ? daily : aggregate(daily, '1d', tf, TZ);
            const cur = series[series.length - 1];
            const prev = series[series.length - 2];
            if (cur) {
              if (lastEmitted && cur.time > lastEmitted.time && prev) {
                h.onCandle({ candle: { ...prev }, closed: true });
              }
              h.onCandle({ candle: { ...cur }, closed: false });
              lastEmitted = cur;
            }
          }
          h.onStatus({
            state: 'ok',
            message: 'Atrasado ~30 min (brapi gratuita)',
            ...(lastValidAt ? { lastValidAt } : {}),
          });
        } catch (err) {
          h.onStatus({
            state: 'error',
            message: (err as Error).message,
            ...(lastValidAt ? { lastValidAt } : {}),
          });
        }
      }
      timer = setTimeout(() => void tick(), this.opts.pollMs ?? 5 * 60_000);
    };
    void tick();
    return {
      close: () => {
        closed = true;
        if (timer) clearTimeout(timer);
      },
    };
  }
}
