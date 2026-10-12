import { Ring, Stream, assertPeriod, runStream } from './stream';

/** Média móvel aritmética (MMA / SMA). Primeiro valor no índice `period - 1`. */
export class SmaStream extends Stream<number, number> {
  private ring: Ring;

  constructor(readonly period: number) {
    super();
    assertPeriod(period, 'SMA');
    this.ring = new Ring(period);
  }

  next(x: number): number {
    if (Number.isNaN(x)) return Number.NaN;
    this.ring.push(x);
    // Soma recalculada a cada passo: evita deriva numérica da soma corrente.
    return this.ring.full ? this.ring.sum() / this.period : Number.NaN;
  }

  clone(): SmaStream {
    const c = new SmaStream(this.period);
    c.ring = this.ring.copy();
    return c;
  }
}

/**
 * Média exponencial genérica com semente pela média aritmética dos primeiros `period` valores
 * (mesma convenção do TA-Lib e do `ta.ema` do TradingView).
 */
class SeededExpStream extends Stream<number, number> {
  private count = 0;
  private seedSum = 0;
  private value = Number.NaN;

  constructor(
    readonly period: number,
    private readonly alpha: number,
  ) {
    super();
  }

  next(x: number): number {
    if (Number.isNaN(x)) return Number.NaN;
    if (this.count < this.period) {
      this.count++;
      this.seedSum += x;
      if (this.count === this.period) this.value = this.seedSum / this.period;
      return this.value;
    }
    this.value = this.alpha * x + (1 - this.alpha) * this.value;
    return this.value;
  }

  clone(): SeededExpStream {
    const c = new SeededExpStream(this.period, this.alpha);
    c.count = this.count;
    c.seedSum = this.seedSum;
    c.value = this.value;
    return c;
  }
}

/** Média móvel exponencial (MME / EMA): alfa = 2 / (n + 1). */
export class EmaStream extends SeededExpStream {
  constructor(period: number) {
    assertPeriod(period, 'EMA');
    super(period, 2 / (period + 1));
  }
}

/** Média de Wilder (RMA / SMMA): alfa = 1 / n. Usada em ATR, ADX e IFR. */
export class RmaStream extends SeededExpStream {
  constructor(period: number) {
    assertPeriod(period, 'RMA');
    super(period, 1 / period);
  }
}

/** Desvio-padrão populacional (divide por n), como o `ta.stdev` padrão do TradingView. */
export class StdDevStream extends Stream<number, number> {
  private ring: Ring;

  constructor(readonly period: number) {
    super();
    assertPeriod(period, 'Desvio-padrão');
    this.ring = new Ring(period);
  }

  next(x: number): number {
    if (Number.isNaN(x)) return Number.NaN;
    this.ring.push(x);
    if (!this.ring.full) return Number.NaN;
    const mean = this.ring.sum() / this.period;
    let acc = 0;
    for (let i = 0; i < this.period; i++) {
      const d = this.ring.at(i) - mean;
      acc += d * d;
    }
    return Math.sqrt(acc / this.period);
  }

  clone(): StdDevStream {
    const c = new StdDevStream(this.period);
    c.ring = this.ring.copy();
    return c;
  }
}

export const sma = (values: readonly number[], period: number): number[] =>
  runStream(new SmaStream(period), values);
export const ema = (values: readonly number[], period: number): number[] =>
  runStream(new EmaStream(period), values);
export const rma = (values: readonly number[], period: number): number[] =>
  runStream(new RmaStream(period), values);
export const stddev = (values: readonly number[], period: number): number[] =>
  runStream(new StdDevStream(period), values);
