import type { Candle, Timeframe } from '@radar/shared';
import { periodKey } from '@radar/core';
import type { CandleUpdate } from './types';

/**
 * Constrói o candle em formação de uma escala a partir de barras menores (ex.: barras de 1 minuto
 * da Alpaca ou cotações periódicas da brapi).
 *
 * - Barra no mesmo período do candle em formação: funde (máx., mín., fechamento, soma do volume).
 * - Barra de período posterior: emite o candle anterior como **fechado** e começa outro.
 * - Barra de período anterior: ignorada (chegou atrasada).
 *
 * Limitação documentada: o candle diário só é marcado como fechado quando chega a primeira barra
 * do pregão seguinte (ou quando `closeCurrent()` é chamado no fim do pregão).
 */
export class LiveCandleBuilder {
  private forming: Candle | null = null;
  private readonly key: (t: number) => number;

  constructor(
    tf: Timeframe,
    tz: string,
    private readonly emit: (u: CandleUpdate) => void,
  ) {
    this.key = periodKey(tf, tz);
  }

  /** Define o candle em formação inicial (ex.: o último candle do histórico). */
  seed(c: Candle | null): void {
    this.forming = c ? { ...c } : null;
  }

  get current(): Candle | null {
    return this.forming ? { ...this.forming } : null;
  }

  /** Funde uma barra menor. `replaceVolume` = a barra traz o volume acumulado do período. */
  push(bar: Candle, opts: { cumulative?: boolean } = {}): void {
    const k = this.key(bar.time);
    const f = this.forming;
    if (f && k < f.time) return;
    if (f && k === f.time) {
      f.high = Math.max(f.high, bar.high);
      f.low = Math.min(f.low, bar.low);
      f.close = bar.close;
      f.volume = opts.cumulative ? bar.volume : f.volume + bar.volume;
      this.emit({ candle: { ...f }, closed: false });
      return;
    }
    if (f) this.emit({ candle: { ...f }, closed: true });
    this.forming = { ...bar, time: k };
    this.emit({ candle: { ...this.forming }, closed: false });
  }

  closeCurrent(): void {
    if (this.forming) this.emit({ candle: { ...this.forming }, closed: true });
    this.forming = null;
  }
}
