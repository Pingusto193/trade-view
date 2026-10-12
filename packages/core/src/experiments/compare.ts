import { sampleLabel } from '../backtest/metrics';

/**
 * Estatística dos experimentos: resultados em R de vários ativos juntos ("pool") e a comparação
 * entre duas variantes com o teste t de Welch — uma régua simples para dizer se a diferença de
 * expectativa é maior que o barulho do acaso.
 */
export interface PooledR {
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
  /** Desvio-padrão dos R (amostral). */
  sdR: number | null;
  /** Soma dos R ganhos ÷ soma dos R perdidos (em módulo). */
  profitFactorR: number | null;
  sample: ReturnType<typeof sampleLabel>;
}

export function pooled(rs: readonly number[]): PooledR {
  const n = rs.length;
  const mean = n ? rs.reduce((s, x) => s + x, 0) / n : null;
  const sd =
    n > 1 && mean !== null
      ? Math.sqrt(rs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1))
      : null;
  const gains = rs.filter((r) => r > 0).reduce((s, x) => s + x, 0);
  const losses = rs.filter((r) => r <= 0).reduce((s, x) => s + x, 0);
  return {
    trades: n,
    winRate: n ? rs.filter((r) => r > 0).length / n : null,
    expectancyR: mean,
    sdR: sd,
    profitFactorR: losses < 0 ? gains / Math.abs(losses) : null,
    sample: sampleLabel(n),
  };
}

export interface Difference {
  /** B − A, em R por trade. */
  diffR: number;
  /** Estatística t de Welch. */
  t: number;
  /** |t| ≥ 2 (≈ 95%): diferença provavelmente maior que o acaso. */
  meaningful: boolean;
}

/** Compara a expectativa de B contra A. Null quando falta amostra (menos de 2 trades em cada). */
export function welch(a: readonly number[], b: readonly number[]): Difference | null {
  const pa = pooled(a);
  const pb = pooled(b);
  if (pa.sdR === null || pb.sdR === null || pa.expectancyR === null || pb.expectancyR === null)
    return null;
  const se = Math.sqrt(pa.sdR ** 2 / pa.trades + pb.sdR ** 2 / pb.trades);
  const diffR = pb.expectancyR - pa.expectancyR;
  const t = se > 0 ? diffR / se : 0;
  return { diffR, t, meaningful: Math.abs(t) >= 2 };
}
