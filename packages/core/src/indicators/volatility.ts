import type { Candle } from '@radar/shared';
import { EmaStream, RmaStream, SmaStream, StdDevStream } from './averages';
import { Stream, assertPeriod, runStream } from './stream';

export type Hlc = Pick<Candle, 'high' | 'low' | 'close'>;

/**
 * True Range. No primeiro candle (sem fechamento anterior) vale máxima − mínima,
 * como o `ta.tr(true)` do TradingView.
 */
export class TrueRangeStream extends Stream<Hlc, number> {
  private prevClose = Number.NaN;

  next(c: Hlc): number {
    const hl = c.high - c.low;
    const tr = Number.isNaN(this.prevClose)
      ? hl
      : Math.max(hl, Math.abs(c.high - this.prevClose), Math.abs(c.low - this.prevClose));
    this.prevClose = c.close;
    return tr;
  }

  clone(): TrueRangeStream {
    const s = new TrueRangeStream();
    s.prevClose = this.prevClose;
    return s;
  }
}

export type AtrSmoothing = 'rma' | 'ema' | 'sma';

/**
 * ATR = média do True Range. Padrão: média de Wilder (RMA), como o ATR clássico.
 * O "Stop ATR" do canal usa média exponencial (SPEC §7).
 */
export class AtrStream extends Stream<Hlc, number> {
  private tr = new TrueRangeStream();
  private avg: Stream<number, number>;

  constructor(
    readonly period: number,
    readonly smoothing: AtrSmoothing = 'rma',
  ) {
    super();
    assertPeriod(period, 'ATR');
    this.avg =
      smoothing === 'rma'
        ? new RmaStream(period)
        : smoothing === 'ema'
          ? new EmaStream(period)
          : new SmaStream(period);
  }

  next(c: Hlc): number {
    return this.avg.next(this.tr.next(c));
  }

  clone(): AtrStream {
    const s = new AtrStream(this.period, this.smoothing);
    s.tr = this.tr.clone();
    s.avg = this.avg.clone();
    return s;
  }
}

export interface BollingerValue {
  middle: number;
  upper: number;
  lower: number;
  /** (upper − lower) / middle — usada na detecção de contração (SPEC §8.6). */
  width: number;
}

/** Bandas de Bollinger: média aritmética ± k desvios-padrão populacionais. */
export class BollingerStream extends Stream<number, BollingerValue> {
  private mid: SmaStream;
  private sd: StdDevStream;

  constructor(
    readonly period: number,
    readonly k: number,
  ) {
    super();
    this.mid = new SmaStream(period);
    this.sd = new StdDevStream(period);
  }

  next(x: number): BollingerValue {
    const m = this.mid.next(x);
    const s = this.sd.next(x);
    const upper = m + this.k * s;
    const lower = m - this.k * s;
    return { middle: m, upper, lower, width: (upper - lower) / m };
  }

  clone(): BollingerStream {
    const c = new BollingerStream(this.period, this.k);
    c.mid = this.mid.clone();
    c.sd = this.sd.clone();
    return c;
  }
}

export interface DmiValue {
  plusDI: number;
  minusDI: number;
  adx: number;
}

/**
 * DMI/ADX de Wilder (convenção documentada em ADR-0008):
 * - +DM, −DM e TR começam no 2º candle (precisam do candle anterior);
 * - suavização de Wilder (RMA) com semente pela média dos primeiros n valores;
 * - +DI/−DI disponíveis a partir do índice n; ADX a partir do índice 2n − 1.
 */
export class DmiStream extends Stream<Hlc, DmiValue> {
  private prev: Hlc | null = null;
  private trS: RmaStream;
  private plusS: RmaStream;
  private minusS: RmaStream;
  private adxS: RmaStream;

  constructor(readonly period: number) {
    super();
    assertPeriod(period, 'ADX');
    this.trS = new RmaStream(period);
    this.plusS = new RmaStream(period);
    this.minusS = new RmaStream(period);
    this.adxS = new RmaStream(period);
  }

  next(c: Hlc): DmiValue {
    const prev = this.prev;
    this.prev = { high: c.high, low: c.low, close: c.close };
    if (!prev) return { plusDI: Number.NaN, minusDI: Number.NaN, adx: Number.NaN };

    const up = c.high - prev.high;
    const down = prev.low - c.low;
    const plusDM = up > down && up > 0 ? up : 0;
    const minusDM = down > up && down > 0 ? down : 0;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );

    const trSm = this.trS.next(tr);
    const plusSm = this.plusS.next(plusDM);
    const minusSm = this.minusS.next(minusDM);
    if (Number.isNaN(trSm)) return { plusDI: Number.NaN, minusDI: Number.NaN, adx: Number.NaN };

    const plusDI = trSm === 0 ? 0 : (100 * plusSm) / trSm;
    const minusDI = trSm === 0 ? 0 : (100 * minusSm) / trSm;
    const sum = plusDI + minusDI;
    const dx = sum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / sum;
    const adx = this.adxS.next(dx);
    return { plusDI, minusDI, adx };
  }

  clone(): DmiStream {
    const s = new DmiStream(this.period);
    s.prev = this.prev ? { ...this.prev } : null;
    s.trS = this.trS.clone() as RmaStream;
    s.plusS = this.plusS.clone() as RmaStream;
    s.minusS = this.minusS.clone() as RmaStream;
    s.adxS = this.adxS.clone() as RmaStream;
    return s;
  }
}

export interface StopAtrValue {
  /** Nível do stop móvel; NaN durante o aquecimento. */
  stop: number;
  /** 1 = acompanhando alta (stop abaixo do preço); −1 = acompanhando baixa (stop acima). */
  direction: 1 | -1 | 0;
}

/**
 * Stop ATR (trailing). SPEC §7: ATR de 20 com média exponencial; multiplicador 2 no semanal e 3 no
 * diário.
 *
 * Regras (decisão nossa, documentada em ADR-0008):
 * - em alta: stop = max(stop anterior, fechamento − m × ATR); vira para baixa quando o
 *   **fechamento** fica abaixo do stop anterior;
 * - em baixa: espelhado;
 * - o primeiro valor começa em alta (convenção arbitrária, só afeta o aquecimento).
 */
export class StopAtrStream extends Stream<Hlc, StopAtrValue> {
  private atr: AtrStream;
  private stop = Number.NaN;
  private dir: 1 | -1 | 0 = 0;

  constructor(
    readonly period: number,
    readonly multiplier: number,
    readonly smoothing: AtrSmoothing = 'ema',
  ) {
    super();
    this.atr = new AtrStream(period, smoothing);
  }

  next(c: Hlc): StopAtrValue {
    const a = this.atr.next(c);
    if (Number.isNaN(a)) return { stop: Number.NaN, direction: 0 };
    const off = this.multiplier * a;
    if (this.dir === 0) {
      this.dir = 1;
      this.stop = c.close - off;
    } else if (this.dir === 1) {
      if (c.close < this.stop) {
        this.dir = -1;
        this.stop = c.close + off;
      } else {
        this.stop = Math.max(this.stop, c.close - off);
      }
    } else if (c.close > this.stop) {
      this.dir = 1;
      this.stop = c.close - off;
    } else {
      this.stop = Math.min(this.stop, c.close + off);
    }
    return { stop: this.stop, direction: this.dir };
  }

  clone(): StopAtrStream {
    const s = new StopAtrStream(this.period, this.multiplier, this.smoothing);
    s.atr = this.atr.clone();
    s.stop = this.stop;
    s.dir = this.dir;
    return s;
  }
}

export const trueRange = (c: readonly Hlc[]): number[] => runStream(new TrueRangeStream(), c);
export const atr = (c: readonly Hlc[], period: number, smoothing: AtrSmoothing = 'rma'): number[] =>
  runStream(new AtrStream(period, smoothing), c);
export const bollinger = (values: readonly number[], period: number, k: number) =>
  runStream(new BollingerStream(period, k), values);
export const dmi = (c: readonly Hlc[], period: number) => runStream(new DmiStream(period), c);
export const stopAtr = (
  c: readonly Hlc[],
  period: number,
  multiplier: number,
  smoothing: AtrSmoothing = 'ema',
) => runStream(new StopAtrStream(period, multiplier, smoothing), c);
