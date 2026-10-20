import type { Candle, Session, SymbolMeta, SymbolSearchResult, Timeframe } from '@radar/shared';
import { marketState } from '@radar/core';
import { HttpClient, type FetchFn } from '../http';
import {
  DataSourceError,
  NotConfiguredError,
  RateLimitError,
  SymbolNotFoundError,
  symbolId,
  type CandleRequest,
  type MarketDataAdapter,
  type SubscribeHandlers,
  type Subscription,
} from '../types';
import { aggregate } from '../util';

/**
 * Forex pela internet — Twelve Data (docs/DATA_SOURCES.md §5.1, ADR-0030). Sem PC Windows: o MT5
 * continua como a outra opção (preço da corretora, tempo real).
 *
 * - Chave (`TWELVE_DATA_KEY`) só no servidor.
 * - Plano grátis (🟡): 8 créditos por minuto e 800 por dia; `time_series` = 1 crédito por chamada.
 *   O adaptador CONTA os créditos e recusa antes de passar do teto do dia (mensagem clara + último
 *   dado válido), em vez de deixar a fonte cortar.
 * - Preço MÉDIO (mid), não o bid/ask de uma corretora; SEM volume (o gráfico esconde o volume).
 * - Horários em UTC (`timezone=UTC`); diário = data do candle (ADR-0006). Onde a fonte fecha o dia de
 *   forex (00:00 UTC ou 17h de Nova York) não está confirmado (❌): vai nas notas do ativo.
 *
 * 🔌 Formato lido no SDK oficial e na documentação; nenhuma chamada real feita do ambiente de
 * desenvolvimento (o teste real roda no workflow "Dados reais" com o segredo TWELVE_DATA_KEY).
 */

/** Pares oferecidos na busca (sem gastar crédito): código, nome, casas decimais. */
export const FX_PAIRS: readonly (readonly [string, string, number])[] = [
  ['EURUSD', 'Euro / Dólar americano', 5],
  ['GBPUSD', 'Libra esterlina / Dólar americano', 5],
  ['USDJPY', 'Dólar americano / Iene', 3],
  ['USDCHF', 'Dólar americano / Franco suíço', 5],
  ['AUDUSD', 'Dólar australiano / Dólar americano', 5],
  ['USDCAD', 'Dólar americano / Dólar canadense', 5],
  ['NZDUSD', 'Dólar neozelandês / Dólar americano', 5],
  ['EURGBP', 'Euro / Libra esterlina', 5],
  ['EURJPY', 'Euro / Iene', 3],
  ['GBPJPY', 'Libra esterlina / Iene', 3],
  ['USDBRL', 'Dólar americano / Real', 4],
  ['EURBRL', 'Euro / Real', 4],
];

/** Janela semanal do forex (DATA_SOURCES §5, 🟡): domingo 17h → sexta 17h em Nova York. */
export const FOREX_NY_SESSION: Session = {
  timezone: 'America/New_York',
  days: [1, 2, 3, 4, 5],
  weekly: { openDay: 0, openTime: '17:00', closeDay: 5, closeTime: '17:00' },
};

const INTERVAL: Readonly<Record<'1m' | '5m' | '15m' | '30m' | '60m' | '1d', string>> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '60m': '1h',
  '1d': '1day',
};

/** Lote padrão de forex (DATA_SOURCES §5): 100.000 unidades da moeda base. */
const LOT_UNITS = 100_000;
const MAX_OUTPUT = 5000;

interface TdValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}
interface TdResponse {
  status?: 'ok' | 'error';
  code?: number;
  message?: string;
  values?: TdValue[];
}

/** "EURUSD" → "EUR/USD" (formato da Twelve Data). */
export const tdSymbol = (pair: string) => `${pair.slice(0, 3)}/${pair.slice(3, 6)}`;

/** "2026-10-20 13:45:00" ou "2026-10-20" (pedidos em UTC) → ms UTC. */
export function parseTdTime(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim());
  if (!m) throw new Error(`horário inesperado da Twelve Data: "${s}"`);
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

/** Valores da Twelve Data (do mais novo para o mais velho) → candles em ordem crescente, sem volume. */
export function parseTdValues(values: readonly TdValue[]): Candle[] {
  const out: Candle[] = [];
  for (const v of values) {
    const c = {
      time: parseTdTime(v.datetime),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: 0,
    };
    if (![c.open, c.high, c.low, c.close].every((x) => Number.isFinite(x) && x > 0)) continue;
    out.push(c);
  }
  out.sort((a, b) => a.time - b.time);
  // a fonte pode repetir o candle mais novo; fica o último visto
  return out.filter((c, i) => out[i + 1]?.time !== c.time);
}

export interface TwelveDataOptions {
  apiKey?: string;
  base?: string;
  fetch?: FetchFn;
  now?: () => number;
  /** Créditos por minuto (plano grátis: 8). */
  perMinute?: number;
  /** Créditos por dia (plano grátis: 800). */
  perDay?: number;
  /** Intervalo de consulta do candle ao vivo (padrão 60 s). */
  pollMs?: number;
  /** Para testes: substitui a espera do limitador por minuto. */
  sleep?: (ms: number) => Promise<void>;
}

export class TwelveDataAdapter implements MarketDataAdapter {
  readonly id = 'fx';
  readonly label = 'Twelve Data';
  readonly market = 'forex' as const;
  private readonly http: HttpClient;
  private readonly base: string;
  private readonly now: () => number;
  private readonly perDay: number;
  private day = '';
  private used = 0;

  constructor(private readonly opts: TwelveDataOptions = {}) {
    this.base = opts.base ?? 'https://api.twelvedata.com';
    this.now = opts.now ?? Date.now;
    this.perDay = opts.perDay ?? 800;
    this.http = new HttpClient({
      source: this.label,
      maxRequests: opts.perMinute ?? 8,
      perMs: 60_000,
      // cada nova tentativa pode gastar crédito: só uma
      retries: 1,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
  }

  isConfigured(): boolean {
    return Boolean(this.opts.apiKey);
  }

  /** Créditos usados hoje (dia UTC — a hora real em que a fonte zera não foi confirmada). */
  quota(): { used: number; limit: number; day: string } {
    this.roll();
    return { used: this.used, limit: this.perDay, day: this.day };
  }

  private roll(): void {
    const d = new Date(this.now()).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.used = 0;
    }
  }

  private async series(pair: string, interval: string, outputsize: number): Promise<Candle[]> {
    if (!this.opts.apiKey)
      throw new NotConfiguredError(this.label, 'defina TWELVE_DATA_KEY no .env do servidor');
    this.roll();
    if (this.used >= this.perDay) {
      throw new DataSourceError(
        `Cota diária da Twelve Data esgotada (${this.used} de ${this.perDay} créditos hoje). O forex pela internet volta amanhã (dia em UTC); o MT5 continua disponível se o PC estiver ligado.`,
        this.label,
        429,
      );
    }
    this.used++;
    const p = new URLSearchParams({
      symbol: tdSymbol(pair),
      interval,
      outputsize: String(Math.max(1, Math.min(MAX_OUTPUT, Math.round(outputsize)))),
      timezone: 'UTC',
      apikey: this.opts.apiKey,
    });
    const r = await this.http.getJson<TdResponse>(`${this.base}/time_series?${p.toString()}`);
    if (r.status === 'error') {
      if (r.code === 429) throw new RateLimitError(this.label);
      if (r.code === 401 || r.code === 403)
        throw new DataSourceError(
          `Twelve Data recusou a chave: ${r.message ?? ''}`.trim(),
          this.label,
          r.code,
        );
      if (r.code === 400 || r.code === 404) throw new SymbolNotFoundError(this.label, pair);
      throw new DataSourceError(r.message ?? 'erro da Twelve Data', this.label, r.code);
    }
    return parseTdValues(r.values ?? []);
  }

  private pair(symbol: string): readonly [string, string, number] {
    const p = FX_PAIRS.find(([s]) => s === symbol.toUpperCase());
    if (!p) throw new SymbolNotFoundError(this.label, symbol);
    return p;
  }

  async searchSymbols(text: string): Promise<SymbolSearchResult[]> {
    const q = text.trim().toUpperCase().replace('/', '');
    if (!q) return [];
    return FX_PAIRS.filter(([s, n]) => s.includes(q) || n.toUpperCase().includes(q)).map(
      ([s, n]) => ({
        id: symbolId(this.id, s),
        symbol: s,
        name: this.isConfigured() ? n : `${n} (sem chave: veja Fontes de dados)`,
        market: this.market,
        sourceLabel: this.label,
      }),
    );
  }

  async getMeta(symbol: string): Promise<SymbolMeta> {
    const [s, name, dec] = this.pair(symbol);
    return {
      id: symbolId(this.id, s),
      symbol: s,
      name,
      market: 'forex',
      source: this.id,
      sourceLabel: this.label,
      currency: s.slice(3, 6),
      tickSize: 10 ** -dec,
      lotSize: 1,
      minQty: 0.01,
      qtyStep: 0.01,
      priceDecimals: dec,
      pointValue: LOT_UNITS,
      delay: { kind: 'delayed', minutes: 1 },
      volume: 'none',
      liveVolume: 'none',
      session: FOREX_NY_SESSION,
      timeframes: ['1m', '5m', '15m', '30m', '60m', '1d', '1w', '1M'],
      adjusted: 'no',
      notes: [
        'Forex pela internet (Twelve Data): preço MÉDIO de mercado, não o preço de compra/venda da sua corretora — stops e alvos podem diferir em cerca de meio spread.',
        'SEM volume: forex é mercado de balcão. Regras de volume dos setups não valem aqui.',
        'Atualiza a cada 1 minuto enquanto o gráfico está aberto; o atraso da própria fonte não foi medido.',
        'Plano grátis: 800 consultas por dia. Quando acabar, o gráfico mostra o último dado guardado até o dia seguinte.',
        'Onde a fonte fecha o candle diário (meia-noite UTC ou 17h de Nova York) não foi confirmado.',
        `Quantidade em lotes (1 lote = ${LOT_UNITS.toLocaleString('pt-BR')} ${s.slice(0, 3)}).`,
      ],
    };
  }

  async getCandles(req: CandleRequest): Promise<Candle[]> {
    const [s] = this.pair(req.symbol);
    let candles: Candle[];
    if (req.tf === '1w' || req.tf === '1M') {
      // semanal e mensal montados a partir do diário (mesma regra de semana do resto do app)
      candles = aggregate(await this.series(s, '1day', MAX_OUTPUT), '1d', req.tf, 'UTC');
    } else {
      candles = await this.series(s, INTERVAL[req.tf], req.limit ?? 1500);
    }
    if (req.from !== undefined) candles = candles.filter((c) => c.time >= (req.from as number));
    if (req.to !== undefined) candles = candles.filter((c) => c.time <= (req.to as number));
    return req.limit ? candles.slice(-req.limit) : candles;
  }

  subscribe(symbol: string, tf: Timeframe, h: SubscribeHandlers): Subscription {
    if (!this.isConfigured()) {
      h.onStatus({
        state: 'not-configured',
        message: 'Forex pela internet sem chave: defina TWELVE_DATA_KEY (ou use o MT5)',
      });
      return { close: () => undefined };
    }
    let s: string;
    try {
      [s] = this.pair(symbol);
    } catch (e) {
      h.onStatus({ state: 'error', message: (e as Error).message });
      return { close: () => undefined };
    }
    let lastEmitted: Candle | null = null;
    let lastValidAt: number | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const latest = async (): Promise<Candle[]> => {
      if (tf === '1w' || tf === '1M') {
        // dias suficientes para fechar o período anterior e montar o atual (1 crédito)
        const days = await this.series(s, '1day', tf === '1w' ? 14 : 62);
        return aggregate(days, '1d', tf, 'UTC').slice(-2);
      }
      return (await this.series(s, INTERVAL[tf], 2)).slice(-2);
    };

    const tick = async () => {
      if (closed) return;
      if (marketState(FOREX_NY_SESSION, this.now()) === 'closed') {
        // fim de semana do forex: nada muda, nenhum crédito gasto
        h.onStatus({ state: 'market-closed', ...(lastValidAt ? { lastValidAt } : {}) });
      } else {
        try {
          const [prev, cur] = await latest();
          if (cur) {
            if (lastEmitted && cur.time > lastEmitted.time && prev)
              h.onCandle({ candle: { ...prev }, closed: true });
            h.onCandle({ candle: { ...cur }, closed: false });
            lastEmitted = cur;
            lastValidAt = this.now();
          }
          const q = this.quota();
          h.onStatus({
            state: 'ok',
            message: `Twelve Data: preço médio, sem volume, a cada 1 min (${q.used}/${q.limit} consultas hoje)`,
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
      if (!closed) timer = setTimeout(() => void tick(), this.opts.pollMs ?? 60_000);
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
