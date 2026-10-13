import type { PaperStats } from '@radar/shared';

/**
 * Estatísticas de um diário (SPEC §11 e §13). Uma única implementação para o treino ao vivo, o
 * replay e os trades reais — é o que permite comparar os três lado a lado.
 */
export interface StatTrade {
  /** Resultado líquido em R$ (depois de custos). */
  realizedBrl: number;
  feesBrl: number;
  /** Resultado em R (null = entrou sem stop). */
  r: number | null;
  hasStop: boolean;
  stopMovedBack: boolean;
  /** Entrou com o plano completo ("Liberado"). */
  planReleased: boolean;
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * @param trades fechados, em ordem de fechamento
 * @param initialBalance patrimônio de partida para a queda máxima em % (null = só em R$)
 */
export function journalStats(
  trades: readonly StatTrade[],
  initialBalance: number | null,
): PaperStats {
  const n = trades.length;
  const wins = trades.filter((t) => t.realizedBrl > 0).length;
  const withR = trades.filter((t) => t.r !== null);
  // sem saldo inicial conhecido (diário real), a queda é medida a partir de zero: só em R$
  let peak = initialBalance ?? 0;
  let equity = peak;
  let ddBrl = 0;
  let ddPct = 0;
  for (const t of trades) {
    equity += t.realizedBrl;
    peak = Math.max(peak, equity);
    ddBrl = Math.max(ddBrl, peak - equity);
    if (initialBalance !== null) ddPct = Math.max(ddPct, peak > 0 ? (peak - equity) / peak : 0);
  }
  const total = trades.reduce((s, t) => s + t.realizedBrl, 0);
  const disciplined = trades.filter((t) => t.planReleased && t.hasStop && !t.stopMovedBack).length;
  return {
    trades: n,
    wins,
    winRate: n ? wins / n : null,
    avgR: withR.length ? round(withR.reduce((s, t) => s + (t.r ?? 0), 0) / withR.length, 2) : null,
    expectancyBrl: n ? round(total / n) : null,
    totalBrl: round(total),
    feesBrl: round(trades.reduce((s, t) => s + t.feesBrl, 0)),
    maxDrawdownBrl: round(ddBrl),
    maxDrawdownPct: round(ddPct * 100, 2),
    withoutStop: trades.filter((t) => !t.hasStop).length,
    stopMovedBack: trades.filter((t) => t.stopMovedBack).length,
    withPlan: trades.filter((t) => t.planReleased).length,
    disciplinePct: n ? round((disciplined / n) * 100, 1) : null,
  };
}
