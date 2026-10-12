import type { PaParams } from './params';
import type { SeriesBuffer } from './series';

/**
 * Primitivas de price action (SPEC §8.1). Todas recebem o índice `t` do candle fechado e leem
 * apenas candles ≤ t.
 */

const range = (h: number, l: number) => h - l;

export function insideBar(s: SeriesBuffer, t: number): boolean {
  if (t < 1) return false;
  const c = s.c(t);
  const p = s.c(t - 1);
  return c.high < p.high && c.low > p.low;
}

/** Candle de força de alta: corpo ≥ k × média dos 20 anteriores e fechamento no quarto superior. */
export function strongBull(s: SeriesBuffer, t: number, p: PaParams): boolean {
  const c = s.c(t);
  const avg = s.v(s.bodyAvg20, t);
  const r = range(c.high, c.low);
  if (!(avg > 0) || r <= 0 || c.close <= c.open) return false;
  return c.close - c.open >= p.strongBodyMult * avg && c.close >= c.high - r / 4;
}

export function strongBear(s: SeriesBuffer, t: number, p: PaParams): boolean {
  const c = s.c(t);
  const avg = s.v(s.bodyAvg20, t);
  const r = range(c.high, c.low);
  if (!(avg > 0) || r <= 0 || c.close >= c.open) return false;
  return c.open - c.close >= p.strongBodyMult * avg && c.close <= c.low + r / 4;
}

/** Barra de ignição (alta): corpo ≥ 2 × média e sombra superior ≤ 10% da amplitude. */
export function ignitionBull(s: SeriesBuffer, t: number, p: PaParams): boolean {
  const c = s.c(t);
  const avg = s.v(s.bodyAvg20, t);
  const r = range(c.high, c.low);
  if (!(avg > 0) || r <= 0 || c.close <= c.open) return false;
  return (
    c.close - c.open >= p.ignitionBodyMult * avg && c.high - c.close <= p.ignitionMaxShadow * r
  );
}

/** Martelo: sombra inferior ≥ 2 × corpo, sombra superior ≤ 25% da amplitude, corpo no terço superior. */
export function hammer(s: SeriesBuffer, t: number, p: PaParams): boolean {
  const c = s.c(t);
  const r = range(c.high, c.low);
  if (r <= 0) return false;
  const body = Math.abs(c.close - c.open);
  const lowerShadow = Math.min(c.open, c.close) - c.low;
  const upperShadow = c.high - Math.max(c.open, c.close);
  const bodyBottom = Math.min(c.open, c.close);
  return (
    lowerShadow >= p.hammerShadowMult * Math.max(body, r * 1e-9) &&
    upperShadow <= p.hammerMaxUpper * r &&
    bodyBottom >= c.low + (2 / 3) * r
  );
}

/** Martelo invertido / "estrela cadente" — espelho para setups de venda. */
export function shootingStar(s: SeriesBuffer, t: number, p: PaParams): boolean {
  const c = s.c(t);
  const r = range(c.high, c.low);
  if (r <= 0) return false;
  const body = Math.abs(c.close - c.open);
  const upperShadow = c.high - Math.max(c.open, c.close);
  const lowerShadow = Math.min(c.open, c.close) - c.low;
  const bodyTop = Math.max(c.open, c.close);
  return (
    upperShadow >= p.hammerShadowMult * Math.max(body, r * 1e-9) &&
    lowerShadow <= p.hammerMaxUpper * r &&
    bodyTop <= c.low + (1 / 3) * r
  );
}

export function doji(s: SeriesBuffer, t: number, p: PaParams): boolean {
  const c = s.c(t);
  const r = range(c.high, c.low);
  return r > 0 && Math.abs(c.close - c.open) <= p.dojiMaxBody * r;
}

// ---------------------------------------------------------------- médias

/** MA virou para cima em t: MA[t] > MA[t−1] e MA[t−1] ≤ MA[t−2]. */
export function turnedUp(s: SeriesBuffer, ma: readonly number[], t: number): boolean {
  const a = s.v(ma, t);
  const b = s.v(ma, t - 1);
  const c = s.v(ma, t - 2);
  return a > b && b <= c;
}

export function turnedDown(s: SeriesBuffer, ma: readonly number[], t: number): boolean {
  const a = s.v(ma, t);
  const b = s.v(ma, t - 1);
  const c = s.v(ma, t - 2);
  return a < b && b >= c;
}

export function rising(s: SeriesBuffer, ma: readonly number[], t: number): boolean {
  return s.v(ma, t) > s.v(ma, t - 1);
}

export function falling(s: SeriesBuffer, ma: readonly number[], t: number): boolean {
  return s.v(ma, t) < s.v(ma, t - 1);
}

export type SlopeClass =
  'acentuada-alta' | 'suave-alta' | 'plana' | 'suave-baixa' | 'acentuada-baixa' | 'virando';

/** Inclinação normalizada: (MA[t] − MA[t−k]) ÷ ATR14[t]. */
export function slope(s: SeriesBuffer, ma: readonly number[], t: number, p: PaParams): number {
  const atr = s.v(s.atr14, t);
  const a = s.v(ma, t);
  const b = s.v(ma, t - p.slopeLookback);
  return atr > 0 ? (a - b) / atr : Number.NaN;
}

export function classifySlope(
  s: SeriesBuffer,
  ma: readonly number[],
  t: number,
  p: PaParams,
): SlopeClass | null {
  const k = slope(s, ma, t, p);
  if (!Number.isFinite(k)) return null;
  if (turnedUp(s, ma, t) || turnedDown(s, ma, t)) return 'virando';
  if (Math.abs(k) < p.flatSlope) return 'plana';
  if (k >= p.steepSlope) return 'acentuada-alta';
  if (k > 0) return 'suave-alta';
  if (k <= -p.steepSlope) return 'acentuada-baixa';
  return 'suave-baixa';
}

// ---------------------------------------------------------------- volume

export type VolumeClass = 'abaixo' | 'acima' | 'muito-acima' | 'estrondoso';

export function volumeClass(s: SeriesBuffer, t: number, p: PaParams): VolumeClass | null {
  const avg = s.v(s.volSma21, t - 1); // média dos 21 anteriores
  const v = s.c(t).volume;
  if (!(avg > 0)) return null;
  if (v >= p.volHuge * avg) return 'estrondoso';
  if (v >= p.volHigh * avg) return 'muito-acima';
  if (v > avg) return 'acima';
  return 'abaixo';
}

/** Volume relativo à média dos 21 anteriores. */
export function relVolume(s: SeriesBuffer, t: number): number {
  const avg = s.v(s.volSma21, t - 1);
  return avg > 0 ? s.c(t).volume / avg : Number.NaN;
}

/**
 * Volume "secando" no trecho [from, t]: média do trecho menor que a média de 21 antes do trecho e
 * inclinação negativa (regressão linear simples).
 */
export function volumeDrying(s: SeriesBuffer, from: number, t: number): boolean {
  const n = t - from + 1;
  if (n < 2 || from < 1) return false;
  const before = s.v(s.volSma21, from - 1);
  if (!(before > 0)) return false;
  let sum = 0;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let i = from; i <= t; i++) {
    const v = s.c(i).volume;
    const x = i - from;
    sum += v;
    sx += x;
    sy += v;
    sxy += x * v;
    sxx += x * x;
  }
  const slopeV = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return sum / n < before && slopeV < 0;
}

// ---------------------------------------------------------------- rompimentos

/** Rompimento válido de um nível (por fechamento, ou pavio se configurado). */
export function brokeAbove(s: SeriesBuffer, t: number, level: number, p: PaParams): boolean {
  const c = s.c(t);
  return p.breakoutByClose ? c.close > level : c.high > level;
}

export function brokeBelow(s: SeriesBuffer, t: number, level: number, p: PaParams): boolean {
  const c = s.c(t);
  return p.breakoutByClose ? c.close < level : c.low < level;
}

/**
 * Falso rompimento para cima: rompeu por fechamento em `breakIdx` e, em até N candles, voltou a fechar
 * abaixo do nível. Só pode ser avaliado em t ≥ breakIdx + 1.
 */
export function falseBreakoutUp(
  s: SeriesBuffer,
  breakIdx: number,
  t: number,
  level: number,
  p: PaParams,
): boolean {
  for (let i = breakIdx + 1; i <= Math.min(t, breakIdx + p.falseBreakBars); i++) {
    if (s.c(i).close <= level) return true;
  }
  return false;
}
