import type {
  Candle,
  FeedStatus,
  Market,
  SymbolMeta,
  SymbolSearchResult,
  Timeframe,
} from '@radar/shared';

/** Atualização de candle vinda de uma assinatura em tempo real. */
export interface CandleUpdate {
  candle: Candle;
  /** true = candle fechado; false = candle em formação. */
  closed: boolean;
}

export interface SubscribeHandlers {
  onCandle(update: CandleUpdate): void;
  onStatus(status: FeedStatus): void;
  /** Chamado após reconexão, para o servidor recarregar candles perdidos. */
  onReconnect?(): void;
}

export interface Subscription {
  close(): void;
}

export interface CandleRequest {
  symbol: string;
  tf: Timeframe;
  /** UTC ms, inclusivo. */
  from?: number;
  /** UTC ms, inclusivo. */
  to?: number;
  /** Máximo de candles mais recentes. */
  limit?: number;
}

/**
 * Interface única de fonte de dados (SPEC §6).
 * Cada adaptador conhece só a sua fonte; o servidor agrega e repassa ao navegador.
 */
export interface MarketDataAdapter {
  readonly id: string;
  readonly label: string;
  readonly market: Market;
  /** Tem chave/configuração necessária? Sem ela o app mostra "fonte não configurada". */
  isConfigured(): boolean;
  /** Fonte de dados simulados (só desenvolvimento)? */
  readonly simulated?: boolean;
  /** Validade do meta no cache do servidor (ms); ausente = vale até reiniciar. */
  readonly metaTtlMs?: number;
  searchSymbols(text: string): Promise<SymbolSearchResult[]>;
  getMeta(symbol: string): Promise<SymbolMeta>;
  getCandles(req: CandleRequest): Promise<Candle[]>;
  subscribe(symbol: string, tf: Timeframe, handlers: SubscribeHandlers): Subscription;
}

// ------------------------------------------------------------------ erros

export class DataSourceError extends Error {
  constructor(
    message: string,
    readonly source: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DataSourceError';
  }
}

export class RateLimitError extends DataSourceError {
  constructor(
    source: string,
    readonly retryAfterMs?: number,
  ) {
    super(`Limite de requisições atingido na fonte ${source}`, source, 429);
    this.name = 'RateLimitError';
  }
}

export class NotConfiguredError extends DataSourceError {
  constructor(source: string, what: string) {
    super(`Fonte ${source} não configurada: ${what}`, source);
    this.name = 'NotConfiguredError';
  }
}

export class SymbolNotFoundError extends DataSourceError {
  constructor(source: string, symbol: string) {
    super(`Ativo "${symbol}" não encontrado na fonte ${source}`, source, 404);
    this.name = 'SymbolNotFoundError';
  }
}

export class TimeframeNotSupportedError extends DataSourceError {
  constructor(source: string, tf: Timeframe) {
    super(`A fonte ${source} não oferece a escala ${tf}`, source);
    this.name = 'TimeframeNotSupportedError';
  }
}

/** Separa "binance:BTCUSDT" em fonte e código. */
export function parseSymbolId(id: string): { source: string; symbol: string } {
  const i = id.indexOf(':');
  if (i <= 0 || i === id.length - 1) throw new Error(`id de ativo inválido: "${id}"`);
  return { source: id.slice(0, i), symbol: id.slice(i + 1) };
}

export function symbolId(source: string, symbol: string): string {
  return `${source}:${symbol}`;
}
