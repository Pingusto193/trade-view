import type { SeriesBuffer } from './series';

export interface Pivot {
  type: 'high' | 'low';
  /** Índice do candle do topo/fundo. */
  index: number;
  /** Índice do candle em que o pivô se CONFIRMA (index + N). Antes disso ele não existe. */
  confirmedAt: number;
  price: number;
  time: number;
}

export type StructureTrend = 'alta' | 'baixa' | 'indefinida';

/**
 * Topos e fundos por fractal (SPEC §8.1): um candle é topo se sua máxima for estritamente maior que as
 * dos N candles de cada lado. Ele só é registrado no candle t = index + N (sem look-ahead).
 */
export class PivotTracker {
  readonly highs: Pivot[] = [];
  readonly lows: Pivot[] = [];
  /** Pivôs de alta já sinalizados (índice do fundo F2), para não repetir. */
  private bullPivotDone = new Set<number>();
  private bearPivotDone = new Set<number>();

  constructor(readonly n: number) {}

  /** Processa o candle t (fechado). Retorna os pivôs confirmados agora. */
  step(s: SeriesBuffer, t: number): Pivot[] {
    const m = t - this.n;
    if (m - this.n < 0) return [];
    const c = s.c(m);
    let isHigh = true;
    let isLow = true;
    for (let k = m - this.n; k <= m + this.n; k++) {
      if (k === m) continue;
      const o = s.c(k);
      if (o.high >= c.high) isHigh = false;
      if (o.low <= c.low) isLow = false;
    }
    const out: Pivot[] = [];
    if (isHigh) {
      const p: Pivot = { type: 'high', index: m, confirmedAt: t, price: c.high, time: c.time };
      this.highs.push(p);
      out.push(p);
    }
    if (isLow) {
      const p: Pivot = { type: 'low', index: m, confirmedAt: t, price: c.low, time: c.time };
      this.lows.push(p);
      out.push(p);
    }
    return out;
  }

  /** Tendência pela estrutura: dois últimos topos e fundos ascendentes (alta) ou descendentes (baixa). */
  trend(): StructureTrend {
    const h = this.highs.slice(-2);
    const l = this.lows.slice(-2);
    if (h.length < 2 || l.length < 2) return 'indefinida';
    const [h1, h2] = h as [Pivot, Pivot];
    const [l1, l2] = l as [Pivot, Pivot];
    if (h2.price > h1.price && l2.price > l1.price) return 'alta';
    if (h2.price < h1.price && l2.price < l1.price) return 'baixa';
    return 'indefinida';
  }

  lastLow(): Pivot | undefined {
    return this.lows[this.lows.length - 1];
  }

  lastHigh(): Pivot | undefined {
    return this.highs[this.highs.length - 1];
  }

  /**
   * Pivô de alta (SPEC §8.1): fundo F2 mais alto que o fundo anterior F1, seguido de fechamento acima do
   * topo intermediário entre eles. Retorna o nível rompido quando acontece em t.
   */
  bullishPivot(s: SeriesBuffer, t: number): { f1: Pivot; f2: Pivot; top: number } | null {
    const lows = this.lows;
    if (lows.length < 2) return null;
    const f1 = lows[lows.length - 2] as Pivot;
    const f2 = lows[lows.length - 1] as Pivot;
    if (f2.price <= f1.price || this.bullPivotDone.has(f2.index)) return null;
    let top = Number.NEGATIVE_INFINITY;
    for (let k = f1.index + 1; k < f2.index; k++) top = Math.max(top, s.c(k).high);
    if (!Number.isFinite(top)) return null;
    if (s.c(t).close > top) {
      this.bullPivotDone.add(f2.index);
      return { f1, f2, top };
    }
    return null;
  }

  bearishPivot(s: SeriesBuffer, t: number): { h1: Pivot; h2: Pivot; bottom: number } | null {
    const highs = this.highs;
    if (highs.length < 2) return null;
    const h1 = highs[highs.length - 2] as Pivot;
    const h2 = highs[highs.length - 1] as Pivot;
    if (h2.price >= h1.price || this.bearPivotDone.has(h2.index)) return null;
    let bottom = Number.POSITIVE_INFINITY;
    for (let k = h1.index + 1; k < h2.index; k++) bottom = Math.min(bottom, s.c(k).low);
    if (!Number.isFinite(bottom)) return null;
    if (s.c(t).close < bottom) {
      this.bearPivotDone.add(h2.index);
      return { h1, h2, bottom };
    }
    return null;
  }
}
