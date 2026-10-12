import { upsertCandle } from '@radar/core';
import type { Candle, FeedStatus, SymbolMeta, Timeframe } from '@radar/shared';
import { getCandles } from '../lib/api';
import { marketSocket } from '../lib/ws';

export interface LiveSeriesEvents {
  onReset(candles: Candle[], meta: SymbolMeta, lastOpen: boolean): void;
  onUpdate(candle: Candle, closed: boolean): void;
  onStatus(status: FeedStatus): void;
  onError(message: string): void;
}

/**
 * Série de candles de um ativo numa escala: histórico pela API + atualizações pelo WebSocket.
 * Assina o WebSocket ANTES de buscar o histórico e guarda as atualizações que chegarem nesse meio
 * tempo, para não perder nenhum candle.
 */
export class LiveSeries {
  candles: Candle[] = [];
  meta: SymbolMeta | null = null;
  private buffer: { candle: Candle; closed: boolean }[] = [];
  private loaded = false;
  private unsub: (() => void) | null = null;
  private disposed = false;

  constructor(
    readonly id: string,
    readonly tf: Timeframe,
    private readonly ev: LiveSeriesEvents,
    private readonly limit = 1500,
  ) {}

  async start(): Promise<void> {
    this.unsub = marketSocket.subscribe(this.id, this.tf, (msg) => {
      if (this.disposed) return;
      if (msg.type === 'status') this.ev.onStatus(msg.status);
      else if (msg.type === 'candle') {
        if (!this.loaded) this.buffer.push({ candle: msg.candle, closed: msg.closed });
        else this.apply(msg.candle, msg.closed);
      }
    });
    try {
      const r = await getCandles(this.id, this.tf, this.limit);
      if (this.disposed) return;
      this.candles = r.candles;
      this.meta = r.meta;
      let lastOpen = r.lastCandleOpen;
      for (const b of this.buffer.splice(0)) {
        upsertCandle(this.candles, b.candle);
        if (b.candle.time === this.candles[this.candles.length - 1]?.time) lastOpen = !b.closed;
      }
      this.loaded = true;
      this.ev.onStatus(r.status);
      this.ev.onReset(this.candles, r.meta, lastOpen);
    } catch (err) {
      if (!this.disposed) this.ev.onError((err as Error).message);
    }
  }

  private apply(candle: Candle, closed: boolean): void {
    const last = this.candles[this.candles.length - 1];
    if (last && candle.time < last.time) {
      // correção de candle antigo
      upsertCandle(this.candles, candle);
      this.ev.onReset(this.candles, this.meta as SymbolMeta, false);
      return;
    }
    upsertCandle(this.candles, candle);
    this.ev.onUpdate(candle, closed);
  }

  dispose(): void {
    this.disposed = true;
    this.unsub?.();
  }
}
