import type { Candle, Timeframe } from '@radar/shared';
import { TIMEFRAME_LABEL, higherTimeframe, isIntraday } from '@radar/shared';
import { aggregate } from '../candles/aggregate';
import { DEFAULT_PA, type PaParams } from './params';
import { PivotTracker } from './pivots';
import { SeriesBuffer } from './series';
import type { HigherContext } from './types';

export type HigherTrendLabel = 'alta' | 'baixa' | 'lateral' | 'indefinida';

/**
 * Tendência (estrutura + MMA50 + ADX, mesma regra do painel de contexto) em CADA candle da série,
 * calculada de forma incremental.
 */
export function trendSeries(
  candles: readonly Candle[],
  pa: PaParams = DEFAULT_PA,
): HigherTrendLabel[] {
  const s = new SeriesBuffer();
  const piv = new PivotTracker(pa.pivotN);
  const out: HigherTrendLabel[] = [];
  candles.forEach((c, t) => {
    s.push(c);
    piv.step(s, t);
    const adx = s.v(s.adx, t);
    const up = s.v(s.sma50, t) > s.v(s.sma50, t - 1);
    const down = s.v(s.sma50, t) < s.v(s.sma50, t - 1);
    if (!Number.isFinite(adx) || !Number.isFinite(s.v(s.sma50, t - 1))) out.push('indefinida');
    else if (adx >= 20 && piv.trend() === 'alta' && up) out.push('alta');
    else if (adx >= 20 && piv.trend() === 'baixa' && down) out.push('baixa');
    else out.push('lateral');
  });
  return out;
}

/**
 * Monta a função "tendência da escala maior no candle t" para o motor de setups, a partir dos próprios
 * candles (agregados). Sem look-ahead: o candle menor só vê o último candle MAIOR JÁ FECHADO.
 */
export function higherContextFn(
  candles: readonly Candle[],
  tf: Timeframe,
  tz: string,
  pa: PaParams = DEFAULT_PA,
): { tf: Timeframe; fn: (t: number) => HigherContext | null } | null {
  const higher = higherTimeframe(tf);
  if (!higher) return null;
  // intradiário → diário precisa do fuso; diário+ já está em datas
  const agg = aggregate(candles, tf, higher, isIntraday(tf) ? tz : 'UTC');
  if (agg.length < 30) return null;
  const trends = trendSeries(agg, pa);
  const times = agg.map((c) => c.time);
  const label = TIMEFRAME_LABEL[higher];
  return {
    tf: higher,
    fn: (t: number) => {
      const time = candles[t]?.time;
      if (time === undefined) return null;
      // índice do candle maior que CONTÉM este candle; usamos o anterior (já fechado)
      let lo = 0;
      let hi = times.length - 1;
      let j = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((times[mid] as number) <= time) {
          j = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      const closed = j - 1;
      if (closed < 0) return null;
      const tr = trends[closed] as HigherTrendLabel;
      return tr === 'indefinida' ? null : { trend: tr, tfLabel: label };
    },
  };
}
