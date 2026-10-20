import type { Candle } from '@radar/shared';
import { classifyTrend, type TrendLabel } from './context';
import { DEFAULT_PA, type PaParams } from './params';
import { PivotTracker } from './pivots';
import { SeriesBuffer } from './series';

/**
 * "Para onde o preço tende a ir?" (modo simples, ADR-0029). NÃO é previsão: mostra a tendência de
 * agora (a MESMA regra do painel de contexto, SPEC §9) e o que aconteceu, neste ativo e nesta escala,
 * nas outras vezes em que a tendência estava igual — sempre comparado com um candle qualquer.
 *
 * Sem look-ahead: a tendência de cada candle usa só candles até ele (pivôs só depois de confirmados);
 * o resultado de cada caso olha `horizon` candles à frente, então só entram casos com esse futuro já
 * fechado. Casos sem sobreposição: depois de contar um caso, o próximo do mesmo grupo só a partir do
 * fim da janela dele (senão a mesma subida seria contada várias vezes).
 */
export const READING_HORIZON = 10;
/** Abaixo disso, "poucos casos": não dá para concluir nada. */
export const READING_MIN_CASES = 30;
/** Diferença mínima (pontos percentuais) contra um candle qualquer para falar em vantagem. */
export const READING_MIN_EDGE_PP = 5;
/** Teste simples de proporção: |z| ≥ 2 (≈ 95%) contra a taxa de um candle qualquer. */
export const READING_MIN_Z = 2;

export interface ReadingStats {
  /** Casos sem sobreposição. */
  cases: number;
  /** % dos casos em que o fechamento `horizon` candles depois estava MAIS ALTO. */
  upPct: number | null;
  /** Variação mediana do preço na janela (%), sem custos. */
  medianMovePct: number | null;
  /** Data do primeiro e do último caso. */
  from: number | null;
  to: number | null;
}

export type ReadingVerdict =
  /** a tendência de agora subiu mais vezes que um candle qualquer, com amostra e diferença suficientes */
  | 'sobe-mais'
  /** caiu mais vezes que um candle qualquer */
  | 'cai-mais'
  /** sem diferença clara: a tendência de agora não ajudou a prever neste ativo */
  | 'sem-vantagem'
  | 'poucos-casos'
  | 'sem-dados';

export interface MarketReading {
  index: number;
  time: number;
  trend: TrendLabel;
  adx: number | null;
  horizon: number;
  /** Casos com a mesma tendência de agora. */
  same: ReadingStats;
  /** Qualquer candle com tendência definida (a régua de comparação). */
  base: ReadingStats;
  /** Estatística z da diferença (null sem dados). */
  z: number | null;
  verdict: ReadingVerdict;
  /** Tendência da escala maior, quando informada (a escala maior manda, SPEC §9). */
  higherTrend: TrendLabel | null;
  higherLabel: string | null;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/**
 * Casos sem sobreposição entre os candles cujo rótulo passa em `want`. `labels[i]` é a tendência
 * no candle i; só usa i com i + horizon ≤ último índice.
 */
export function readingStats(
  candles: readonly Candle[],
  labels: readonly TrendLabel[],
  horizon: number,
  want: (l: TrendLabel) => boolean,
): ReadingStats {
  const last = Math.min(candles.length, labels.length) - 1;
  const moves: number[] = [];
  let next = 0;
  let from: number | null = null;
  let to: number | null = null;
  for (let i = 0; i + horizon <= last; i++) {
    if (i < next) continue;
    const l = labels[i] as TrendLabel;
    if (l === 'indefinida' || !want(l)) continue;
    const c0 = (candles[i] as Candle).close;
    const c1 = (candles[i + horizon] as Candle).close;
    if (!(c0 > 0)) continue;
    moves.push(c1 / c0 - 1);
    next = i + horizon;
    from ??= (candles[i] as Candle).time;
    to = (candles[i] as Candle).time;
  }
  const up = moves.filter((m) => m > 0).length;
  const med = median(moves);
  return {
    cases: moves.length,
    upPct: moves.length ? (up / moves.length) * 100 : null,
    medianMovePct: med === null ? null : med * 100,
    from,
    to,
  };
}

/** Veredito honesto: só fala em vantagem com amostra, diferença e z suficientes. */
export function readingVerdict(
  trend: TrendLabel,
  same: ReadingStats,
  base: ReadingStats,
): { verdict: ReadingVerdict; z: number | null } {
  if (trend === 'indefinida' || same.upPct === null || base.upPct === null)
    return { verdict: 'sem-dados', z: null };
  const p = same.upPct / 100;
  const p0 = base.upPct / 100;
  const se = Math.sqrt((p0 * (1 - p0)) / same.cases);
  const z = se > 0 ? (p - p0) / se : null;
  if (same.cases < READING_MIN_CASES) return { verdict: 'poucos-casos', z };
  const edge = (p - p0) * 100;
  if (z !== null && edge >= READING_MIN_EDGE_PP && z >= READING_MIN_Z)
    return { verdict: 'sobe-mais', z };
  if (z !== null && -edge >= READING_MIN_EDGE_PP && z <= -READING_MIN_Z)
    return { verdict: 'cai-mais', z };
  return { verdict: 'sem-vantagem', z };
}

/** Leitura no último candle FECHADO (ou em `lastIndex`). */
export function marketReading(
  candles: readonly Candle[],
  opts: {
    pa?: PaParams;
    horizon?: number;
    lastIndex?: number;
    higherTrend?: TrendLabel | null;
    higherLabel?: string | null;
  } = {},
): MarketReading | null {
  const pa = opts.pa ?? DEFAULT_PA;
  const last = opts.lastIndex ?? candles.length - 1;
  if (last < 30) return null;
  const horizon = opts.horizon ?? READING_HORIZON;
  const s = new SeriesBuffer();
  const piv = new PivotTracker(pa.pivotN);
  const labels: TrendLabel[] = [];
  let adx = Number.NaN;
  for (let i = 0; i <= last; i++) {
    s.push(candles[i] as Candle);
    piv.step(s, i);
    const tr = classifyTrend(s, piv, i, pa);
    labels.push(tr.value);
    if (i === last) adx = tr.adx;
  }
  const trend = labels[last] as TrendLabel;
  const used = candles.slice(0, last + 1);
  const same = readingStats(used, labels, horizon, (l) => l === trend);
  const base = readingStats(used, labels, horizon, () => true);
  const { verdict, z } = readingVerdict(trend, same, base);
  return {
    index: last,
    time: (candles[last] as Candle).time,
    trend,
    adx: Number.isFinite(adx) ? adx : null,
    horizon,
    same,
    base,
    z,
    verdict,
    higherTrend: opts.higherTrend ?? null,
    higherLabel: opts.higherLabel ?? null,
  };
}
