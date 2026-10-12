import type { Candle, FeedStatus, ServerMessage, Timeframe } from '@radar/shared';
import type { Subscription } from '@radar/data';
import type { FastifyBaseLogger } from 'fastify';
import type { CandleStore } from './candle-store';
import type { MarketService } from './service';

type Listener = (msg: ServerMessage) => void;

interface Entry {
  id: string;
  tf: Timeframe;
  listeners: Set<Listener>;
  upstream: Subscription | null;
  status: FeedStatus;
  last: { candle: Candle; closed: boolean } | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Central de tempo real: uma única assinatura na fonte por (ativo, escala), repassada a todos os
 * navegadores conectados. Chaves de API ficam só aqui (SPEC §5).
 */
export class MarketHub {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly market: MarketService,
    private readonly store: CandleStore,
    private readonly log: FastifyBaseLogger,
    /** Tempo que a assinatura na fonte continua viva após o último ouvinte sair. */
    private readonly graceMs = 30_000,
  ) {}

  get activeKeys(): string[] {
    return [...this.entries.keys()];
  }

  subscribe(id: string, tf: Timeframe, listener: Listener): () => void {
    const key = `${id}|${tf}`;
    let e = this.entries.get(key);
    if (!e) {
      e = {
        id,
        tf,
        listeners: new Set(),
        upstream: null,
        status: { state: 'connecting' },
        last: null,
        closeTimer: null,
      };
      this.entries.set(key, e);
      this.start(e);
    }
    if (e.closeTimer) {
      clearTimeout(e.closeTimer);
      e.closeTimer = null;
    }
    e.listeners.add(listener);
    listener({ type: 'status', id, tf, status: e.status });
    if (e.last) listener({ type: 'candle', id, tf, candle: e.last.candle, closed: e.last.closed });
    const entry = e;
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0 && !entry.closeTimer) {
        entry.closeTimer = setTimeout(() => this.stop(key), this.graceMs);
      }
    };
  }

  private broadcast(e: Entry, msg: ServerMessage): void {
    for (const l of e.listeners) {
      try {
        l(msg);
      } catch (err) {
        this.log.warn({ err }, 'falha ao enviar mensagem a um ouvinte');
      }
    }
  }

  private setStatus(e: Entry, status: FeedStatus): void {
    e.status = status;
    this.broadcast(e, { type: 'status', id: e.id, tf: e.tf, status });
  }

  private onCandle(e: Entry, candle: Candle, closed: boolean): void {
    e.last = { candle, closed };
    if (closed) this.store.save(e.id, e.tf, [candle]);
    this.broadcast(e, { type: 'candle', id: e.id, tf: e.tf, candle, closed });
  }

  private start(e: Entry): void {
    let resolved;
    try {
      resolved = this.market.registry.resolve(e.id);
    } catch (err) {
      this.setStatus(e, { state: 'error', message: (err as Error).message });
      return;
    }
    const { adapter, symbol } = resolved;
    e.upstream = adapter.subscribe(symbol, e.tf, {
      onCandle: (u) => this.onCandle(e, u.candle, u.closed),
      onStatus: (s) => this.setStatus(e, s),
      onReconnect: () => void this.backfill(e),
    });
  }

  /** Após reconexão, recarrega candles recentes para cobrir o buraco. */
  private async backfill(e: Entry): Promise<void> {
    try {
      const r = await this.market.getCandles(e.id, e.tf, 200);
      const n = r.candles.length;
      r.candles.forEach((c, i) => {
        const closed = !(i === n - 1 && r.lastCandleOpen);
        this.broadcast(e, { type: 'candle', id: e.id, tf: e.tf, candle: c, closed });
      });
    } catch (err) {
      this.log.warn({ err, key: `${e.id}|${e.tf}` }, 'falha ao recarregar após reconexão');
    }
  }

  private stop(key: string): void {
    const e = this.entries.get(key);
    if (!e || e.listeners.size > 0) return;
    e.upstream?.close();
    this.entries.delete(key);
  }

  closeAll(): void {
    for (const [key, e] of this.entries) {
      if (e.closeTimer) clearTimeout(e.closeTimer);
      e.upstream?.close();
      this.entries.delete(key);
    }
  }
}
