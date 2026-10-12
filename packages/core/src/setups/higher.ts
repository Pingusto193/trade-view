import type { Candle, Timeframe } from '@radar/shared';
import { TIMEFRAME_LABEL, higherTimeframe, isIntraday } from '@radar/shared';
import { periodKey } from '../candles/aggregate';
import { classifyTrend, type TrendLabel } from './context';
import { DEFAULT_PA, type PaParams } from './params';
import { PivotTracker } from './pivots';
import { SeriesBuffer } from './series';
import type { HigherContext } from './types';

export type HigherTrendLabel = TrendLabel;

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
  return candles.map((c, t) => {
    s.push(c);
    piv.step(s, t);
    return classifyTrend(s, piv, t, pa).value;
  });
}

/**
 * Escala maior INCREMENTAL (SPEC §9: "a escala maior manda"). Recebe os candles FECHADOS da escala do
 * gráfico, agrega-os no período maior (`periodKey`, no fuso da bolsa quando a origem é intradiária) e
 * mantém série, pivôs e tendência próprios da escala maior.
 *
 * A tendência só muda quando um período maior FECHA, ou seja, quando chega o primeiro candle menor do
 * período seguinte. Assim cada candle menor enxerga só o último candle maior já fechado (sem
 * look-ahead, inclusive entre fusos) e nada depende da posição em um array externo.
 */
export class HigherTrendTracker {
  /** Escala maior acompanhada. */
  readonly tf: Timeframe;
  readonly label: string;
  private readonly key: (time: number) => number;
  private readonly s = new SeriesBuffer();
  private readonly piv: PivotTracker;
  /** Candle maior em formação (ainda não entra na tendência). */
  private forming: Candle | null = null;
  private current: HigherContext | null = null;

  /** Rastreador da escala imediatamente maior que `tf` (null se não houver escala maior). */
  static for(tf: Timeframe, tz: string, pa: PaParams = DEFAULT_PA): HigherTrendTracker | null {
    const higher = higherTimeframe(tf);
    return higher ? new HigherTrendTracker(tf, higher, tz, pa) : null;
  }

  constructor(
    from: Timeframe,
    to: Timeframe,
    tz: string,
    private readonly pa: PaParams = DEFAULT_PA,
  ) {
    this.tf = to;
    this.label = TIMEFRAME_LABEL[to];
    // intradiário → diário+ precisa do fuso; diário+ já está em datas de pregão (ADR-0006)
    this.key = periodKey(to, isIntraday(from) ? tz : 'UTC');
    this.piv = new PivotTracker(pa.pivotN);
  }

  /** Recebe um candle FECHADO da escala menor e devolve o contexto da escala maior válido para ele. */
  push(c: Candle): HigherContext | null {
    const k = this.key(c.time);
    const cur = this.forming;
    if (cur && k > cur.time) {
      // chegou candle de um período novo: o período maior anterior fechou
      const t = this.s.push(cur);
      this.piv.step(this.s, t);
      const tr = classifyTrend(this.s, this.piv, t, this.pa).value;
      this.current = tr === 'indefinida' ? null : { trend: tr, tfLabel: this.label };
      this.forming = null;
    }
    if (!this.forming) {
      this.forming = {
        time: k,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      };
    } else {
      const b = this.forming;
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
      b.volume += c.volume;
    }
    return this.current;
  }

  /** Contexto da escala maior depois do último candle recebido (último período maior FECHADO). */
  now(): HigherContext | null {
    return this.current;
  }
}

/**
 * Versão em LOTE: o contexto da escala maior em cada candle de `candles`, calculado uma única vez com o
 * rastreador incremental. É um retrato — candles acrescentados depois NÃO entram. Ao vivo, use o
 * `SetupEngine` com `tf`/`tz`, que acompanha a escala maior candle a candle.
 */
export function higherContextFn(
  candles: readonly Candle[],
  tf: Timeframe,
  tz: string,
  pa: PaParams = DEFAULT_PA,
): { tf: Timeframe; fn: (t: number) => HigherContext | null } | null {
  const tracker = HigherTrendTracker.for(tf, tz, pa);
  if (!tracker) return null;
  const snap = candles.map((c) => tracker.push(c));
  return { tf: tracker.tf, fn: (t: number) => snap[t] ?? null };
}
