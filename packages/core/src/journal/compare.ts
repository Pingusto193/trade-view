import type { PaperStats } from '@radar/shared';

/**
 * Comparação entre diários (SPEC §13: "treino ao vivo, replay e real ficam separados e comparáveis
 * lado a lado; uma diferença grande costuma indicar um problema emocional ou de execução").
 * Limites nossos (ADR-0022), arbitrários: só compara com amostra mínima nos dois lados.
 */
export const COMPARE_MIN_TRADES = 20;
/** Diferença de R médio que conta como "grande". */
export const COMPARE_R_GAP = 0.3;
/** Diferença em pontos percentuais de acerto e de disciplina que conta como "grande". */
export const COMPARE_PCT_GAP = 15;

export interface JournalSide {
  label: string;
  stats: PaperStats;
}

export interface CompareResult {
  /** false = amostra pequena em algum lado: só mostra os números, sem conclusão. */
  enough: boolean;
  findings: string[];
}

const pp = (x: number) => `${Math.round(x)} pontos percentuais`;

export function compareJournals(base: JournalSide, other: JournalSide): CompareResult {
  const a = base.stats;
  const b = other.stats;
  if (a.trades < COMPARE_MIN_TRADES || b.trades < COMPARE_MIN_TRADES)
    return { enough: false, findings: [] };
  const findings: string[] = [];
  if (a.avgR !== null && b.avgR !== null && a.avgR - b.avgR >= COMPARE_R_GAP)
    findings.push(
      `R médio no ${other.label} (${b.avgR.toFixed(2)}R) bem abaixo do ${base.label} (${a.avgR.toFixed(2)}R). ` +
        'Costuma ser execução (entrar atrasado, sair cedo, custos maiores) ou emoção.',
    );
  if (a.winRate !== null && b.winRate !== null && (a.winRate - b.winRate) * 100 >= COMPARE_PCT_GAP)
    findings.push(
      `Acerto no ${other.label} ${pp((a.winRate - b.winRate) * 100)} abaixo do ${base.label}.`,
    );
  if (
    a.disciplinePct !== null &&
    b.disciplinePct !== null &&
    a.disciplinePct - b.disciplinePct >= COMPARE_PCT_GAP
  )
    findings.push(
      `Disciplina no ${other.label} ${pp(a.disciplinePct - b.disciplinePct)} abaixo do ${base.label}: ` +
        'menos planos completos, mais trades sem stop ou com stop movido para trás.',
    );
  if (b.stopMovedBack > a.stopMovedBack && b.stopMovedBack / b.trades >= 0.1)
    findings.push(
      `No ${other.label}, ${b.stopMovedBack} de ${b.trades} trades tiveram o stop movido para trás.`,
    );
  return { enough: true, findings };
}
