import type { Candle } from '@radar/shared';
import { rng } from '../backtest/montecarlo';
import { BollingerStream } from '../indicators/volatility';

/**
 * E2 (SPEC §12.4): com que frequência o preço FECHA fora da Bollinger 20/3 e, nesses casos, quantas
 * vezes voltou à média central em até N candles.
 *
 * Duas referências de "mundo normal", porque a conta do vídeo ("1 em 1000") mistura coisas:
 * - a curva normal teórica: 0,135% por lado além de 3 desvios;
 * - um passeio aleatório com retornos normais e a MESMA volatilidade do ativo, medido com a mesma
 *   régua (fechamento fora da banda de 20 candles). As bandas olham só 20 candles, então nem num
 *   mundo normal a taxa bate com 0,135%: comparar com o passeio é o teste justo de caudas gordas.
 */
export interface TailsResult {
  /** Fechamentos com banda calculada (depois do aquecimento). */
  closes: number;
  above: number;
  below: number;
  rateAbove: number;
  rateBelow: number;
  /** Curva normal teórica, por lado (1 − Φ(k)). */
  normalPerSide: number;
  /** Mesma régua num passeio aleatório normal com a volatilidade do ativo (média de várias séries). */
  randomWalkPerSide: number;
  /** Dos fechamentos fora, quantos tocaram a média central em até `horizon` candles. */
  backToMean: { events: number; within: number; rate: number | null };
  horizon: number;
}

/** 1 − Φ(x) pela aproximação de Abramowitz-Stegun (erro < 7,5e-8). */
export function normalTail(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
  const p =
    d *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? p : 1 - p;
}

interface Count {
  closes: number;
  above: number;
  below: number;
  events: number;
  within: number;
}

function count(candles: readonly Candle[], period: number, k: number, horizon: number): Count {
  const bb = new BollingerStream(period, k);
  const mids: number[] = [];
  const out: Count = { closes: 0, above: 0, below: 0, events: 0, within: 0 };
  const pending: { side: 'above' | 'below'; t: number }[] = [];
  candles.forEach((c, t) => {
    const b = bb.next(c.close);
    mids.push(b.middle);
    // eventos anteriores: tocou a média central deste candle?
    for (let i = pending.length - 1; i >= 0; i--) {
      const e = pending[i]!;
      if (t - e.t > horizon) {
        pending.splice(i, 1);
        continue;
      }
      if (t > e.t && Number.isFinite(b.middle)) {
        const touched = e.side === 'above' ? c.low <= b.middle : c.high >= b.middle;
        if (touched) {
          out.within++;
          pending.splice(i, 1);
        }
      }
    }
    if (!Number.isFinite(b.upper)) return;
    out.closes++;
    if (c.close > b.upper) {
      out.above++;
      out.events++;
      pending.push({ side: 'above', t });
    } else if (c.close < b.lower) {
      out.below++;
      out.events++;
      pending.push({ side: 'below', t });
    }
  });
  // eventos perto do fim sem os N candles seguintes: sem como saber, ficam fora da conta
  for (const e of pending) if (e.t + horizon >= candles.length) out.events--;
  return out;
}

export function bollingerTails(
  candles: readonly Candle[],
  opts: { period?: number; k?: number; horizon?: number; walks?: number; seed?: number } = {},
): TailsResult {
  const period = opts.period ?? 20;
  const k = opts.k ?? 3;
  const horizon = opts.horizon ?? 10;
  const c = count(candles, period, k, horizon);

  // volatilidade dos retornos (log) do próprio ativo
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1]!.close;
    const b = candles[i]!.close;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  const mu = rets.reduce((s, x) => s + x, 0) / Math.max(1, rets.length);
  const sigma = Math.sqrt(
    rets.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, rets.length - 1),
  );
  const walks = opts.walks ?? 20;
  const rand = rng(opts.seed ?? 7);
  let wCloses = 0;
  let wOut = 0;
  for (let w = 0; w < walks && sigma > 0 && candles.length > period; w++) {
    let p = 100;
    const series: Candle[] = [];
    for (let i = 0; i < candles.length; i++) {
      // Box-Muller
      const g = Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
      p *= Math.exp(sigma * g);
      series.push({ time: i, open: p, high: p, low: p, close: p, volume: 0 });
    }
    const wc = count(series, period, k, horizon);
    wCloses += wc.closes;
    wOut += wc.above + wc.below;
  }
  return {
    closes: c.closes,
    above: c.above,
    below: c.below,
    rateAbove: c.closes ? c.above / c.closes : 0,
    rateBelow: c.closes ? c.below / c.closes : 0,
    normalPerSide: normalTail(k),
    randomWalkPerSide: wCloses ? wOut / wCloses / 2 : 0,
    backToMean: { events: c.events, within: c.within, rate: c.events ? c.within / c.events : null },
    horizon,
  };
}
