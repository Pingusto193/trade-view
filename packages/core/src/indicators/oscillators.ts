import type { Candle } from '@radar/shared';
import { EmaStream, RmaStream, SmaStream } from './averages';
import { Ring, Stream, assertPeriod, runStream } from './stream';
import type { Hlc } from './volatility';

export interface MacdValue {
  macd: number;
  signal: number;
  histogram: number;
}

/** MACD clássico: MME(rápida) − MME(lenta); sinal = MME do MACD. Opcional, desligado por padrão. */
export class MacdStream extends Stream<number, MacdValue> {
  private fastS: EmaStream;
  private slowS: EmaStream;
  private signalS: EmaStream;

  constructor(
    readonly fast = 12,
    readonly slow = 26,
    readonly signal = 9,
  ) {
    super();
    this.fastS = new EmaStream(fast);
    this.slowS = new EmaStream(slow);
    this.signalS = new EmaStream(signal);
  }

  next(x: number): MacdValue {
    const f = this.fastS.next(x);
    const s = this.slowS.next(x);
    const macd = f - s;
    const sig = this.signalS.next(macd);
    return { macd, signal: sig, histogram: macd - sig };
  }

  clone(): MacdStream {
    const c = new MacdStream(this.fast, this.slow, this.signal);
    c.fastS = this.fastS.clone() as EmaStream;
    c.slowS = this.slowS.clone() as EmaStream;
    c.signalS = this.signalS.clone() as EmaStream;
    return c;
  }
}

/** IFR (RSI) de Wilder. Primeiro valor no índice `period`. */
export class RsiStream extends Stream<number, number> {
  private prev = Number.NaN;
  private gain: RmaStream;
  private loss: RmaStream;

  constructor(readonly period = 14) {
    super();
    assertPeriod(period, 'IFR');
    this.gain = new RmaStream(period);
    this.loss = new RmaStream(period);
  }

  next(x: number): number {
    if (Number.isNaN(x)) return Number.NaN;
    const prev = this.prev;
    this.prev = x;
    if (Number.isNaN(prev)) return Number.NaN;
    const ch = x - prev;
    const g = this.gain.next(Math.max(ch, 0));
    const l = this.loss.next(Math.max(-ch, 0));
    if (Number.isNaN(g)) return Number.NaN;
    if (l === 0) return g === 0 ? 50 : 100;
    return 100 - 100 / (1 + g / l);
  }

  clone(): RsiStream {
    const c = new RsiStream(this.period);
    c.prev = this.prev;
    c.gain = this.gain.clone() as RmaStream;
    c.loss = this.loss.clone() as RmaStream;
    return c;
  }
}

export interface StochasticValue {
  k: number;
  d: number;
}

/** Estocástico lento: %K bruto em n períodos, suavizado por MMA, e %D = MMA do %K. */
export class StochasticStream extends Stream<Hlc, StochasticValue> {
  private highs: Ring;
  private lows: Ring;
  private kS: SmaStream;
  private dS: SmaStream;

  constructor(
    readonly period = 14,
    readonly kSmooth = 3,
    readonly dPeriod = 3,
  ) {
    super();
    assertPeriod(period, 'Estocástico');
    this.highs = new Ring(period);
    this.lows = new Ring(period);
    this.kS = new SmaStream(kSmooth);
    this.dS = new SmaStream(dPeriod);
  }

  next(c: Hlc): StochasticValue {
    this.highs.push(c.high);
    this.lows.push(c.low);
    if (!this.highs.full) return { k: Number.NaN, d: Number.NaN };
    const hh = this.highs.max();
    const ll = this.lows.min();
    const raw = hh === ll ? 50 : (100 * (c.close - ll)) / (hh - ll);
    const k = this.kS.next(raw);
    const d = this.dS.next(k);
    return { k, d };
  }

  clone(): StochasticStream {
    const s = new StochasticStream(this.period, this.kSmooth, this.dPeriod);
    s.highs = this.highs.copy();
    s.lows = this.lows.copy();
    s.kS = this.kS.clone() as SmaStream;
    s.dS = this.dS.clone() as SmaStream;
    return s;
  }
}

/**
 * VWAP ancorada na sessão: zera quando muda a chave de sessão (data local da bolsa).
 * `sessionKey` recebe o tempo do candle e devolve um identificador do pregão.
 */
export class VwapStream extends Stream<Candle, number> {
  private key: number | null = null;
  private pv = 0;
  private vol = 0;

  constructor(private readonly sessionKey: (time: number) => number) {
    super();
  }

  next(c: Candle): number {
    const k = this.sessionKey(c.time);
    if (k !== this.key) {
      this.key = k;
      this.pv = 0;
      this.vol = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    this.pv += typical * c.volume;
    this.vol += c.volume;
    return this.vol === 0 ? Number.NaN : this.pv / this.vol;
  }

  clone(): VwapStream {
    const s = new VwapStream(this.sessionKey);
    s.key = this.key;
    s.pv = this.pv;
    s.vol = this.vol;
    return s;
  }
}

export const macd = (values: readonly number[], fast = 12, slow = 26, signal = 9) =>
  runStream(new MacdStream(fast, slow, signal), values);
export const rsi = (values: readonly number[], period = 14) =>
  runStream(new RsiStream(period), values);
export const stochastic = (c: readonly Hlc[], period = 14, kSmooth = 3, dPeriod = 3) =>
  runStream(new StochasticStream(period, kSmooth, dPeriod), c);
export const vwap = (c: readonly Candle[], sessionKey: (time: number) => number) =>
  runStream(new VwapStream(sessionKey), c);
