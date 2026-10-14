import type { Candle, CandlesResponse, FeedStatus, SymbolMeta, Timeframe } from '@radar/shared';
import { isIntraday } from '@radar/shared';
import { aggregate, marketState, periodKey } from '@radar/core';
import {
  NotConfiguredError,
  RateLimitError,
  type AdapterRegistry,
  type MarketDataAdapter,
} from '@radar/data';
import type { CandleStore } from './candle-store';

/** Id usado no cache para o histórico importado do COTAHIST da B3. */
export const cotahistId = (ticker: string) => `cotahist:${ticker}`;

/**
 * Tempo mínimo entre buscas na fonte para a mesma série (protege as cotas gratuitas).
 * Binance não tem cota relevante para este uso; brapi tem 15 mil requisições por mês.
 */
function cacheTtlMs(adapter: MarketDataAdapter, tf: Timeframe): number {
  switch (adapter.id) {
    case 'brapi':
      return 15 * 60_000;
    case 'alpaca':
      return isIntraday(tf) ? 2 * 60_000 : 30 * 60_000;
    default:
      return 0;
  }
}

function errorStatus(err: unknown, lastValidAt?: number): FeedStatus {
  const base = lastValidAt ? { lastValidAt } : {};
  if (err instanceof NotConfiguredError)
    return { state: 'not-configured', message: err.message, ...base };
  if (err instanceof RateLimitError)
    return { state: 'rate-limited', message: err.message, ...base };
  return { state: 'error', message: (err as Error).message, ...base };
}

export class MarketService {
  private readonly metaCache = new Map<string, { meta: SymbolMeta; at: number }>();

  constructor(
    readonly registry: AdapterRegistry,
    private readonly store: CandleStore,
    private readonly now: () => number = Date.now,
  ) {}

  async getMeta(id: string): Promise<SymbolMeta> {
    const { adapter, symbol } = this.registry.resolve(id);
    const hit = this.metaCache.get(id);
    // Fontes cujo meta muda com o tempo (agente MT5: corretora, fuso, volume) pedem renovação.
    if (hit && (adapter.metaTtlMs === undefined || this.now() - hit.at < adapter.metaTtlMs)) {
      return hit.meta;
    }
    const meta = await adapter.getMeta(symbol);
    this.metaCache.set(id, { meta, at: this.now() });
    return meta;
  }

  /** O último candle ainda está em formação? */
  isOpen(meta: SymbolMeta, tf: Timeframe, last: Candle | undefined): boolean {
    if (!last) return false;
    const now = this.now();
    const key = periodKey(tf, meta.session.timezone)(now);
    if (key !== last.time) return false;
    if (isIntraday(tf)) return true;
    return marketState(meta.session, now) !== 'closed';
  }

  async getCandles(id: string, tf: Timeframe, limit = 1500): Promise<CandlesResponse> {
    const { adapter, symbol } = this.registry.resolve(id);
    const meta = await this.getMeta(id).catch(() => null);
    if (!meta) {
      return {
        meta: await adapter.getMeta(symbol), // deixa o erro subir com a mensagem da fonte
        candles: [],
        status: { state: 'error', message: 'metadados indisponíveis' },
        lastCandleOpen: false,
      };
    }
    // brapi: busca o diário e agrega aqui, para emendar com o COTAHIST importado.
    const useB3History = adapter.id === 'brapi';
    const fetchTf: Timeframe = useB3History ? '1d' : tf;
    const info = this.store.fetchInfo(id, fetchTf);
    const now = this.now();
    let status: FeedStatus;
    const ttl = cacheTtlMs(adapter, fetchTf);
    const fresh = info && info.fetchedAt > 0 && now - info.fetchedAt < ttl;

    if (fresh) {
      status = { state: 'ok', lastValidAt: info.fetchedAt };
    } else {
      try {
        const got = await adapter.getCandles({
          symbol,
          tf: fetchTf,
          limit: useB3History ? 5000 : limit,
        });
        this.store.save(id, fetchTf, got);
        this.store.markFetched(id, fetchTf, now);
        status = { state: 'ok', lastValidAt: now };
      } catch (err) {
        this.store.markError(id, fetchTf, (err as Error).message, now);
        status = errorStatus(err, info?.fetchedAt || undefined);
      }
    }

    let series = this.store.load(id, fetchTf, useB3History ? {} : { limit });
    const outMeta: SymbolMeta = { ...meta, notes: [...meta.notes] };
    if (useB3History) {
      const first = series[0]?.time ?? Number.POSITIVE_INFINITY;
      const hist = this.store.load(cotahistId(symbol), '1d', { to: first - 1 });
      if (hist.length) {
        series = [...hist, ...series];
        outMeta.adjusted = 'no';
        outMeta.notes.push(
          'Histórico anterior a 3 meses vem do COTAHIST da B3, SEM ajuste por proventos e desdobramentos.',
        );
      }
      if (tf !== '1d') series = aggregate(series, '1d', tf, meta.session.timezone);
      series = series.slice(-limit);
    }
    if (status.state !== 'ok' && series.length) {
      status = { ...status, lastValidAt: status.lastValidAt ?? series[series.length - 1]?.time };
    }
    return {
      meta: outMeta,
      candles: series,
      status,
      lastCandleOpen: this.isOpen(meta, tf, series[series.length - 1]),
    };
  }
}
