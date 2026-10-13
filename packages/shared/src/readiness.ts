import { z } from 'zod';
import { formatBRL, formatNumber } from './format';
import type { PaperPosition } from './paper';

/**
 * Painel de prontidão (SPEC §13): os números do treino justificam arriscar dinheiro real? Régua NOSSA
 * (critérios heurísticos e editáveis), nunca uma garantia — e nunca bloqueia o modo Real.
 */
export const readinessParamsSchema = z.object({
  /** Trades de treino no total (replay + ao vivo; o replay ainda não existe). */
  minTrades: z.number().int().min(1).max(10_000).default(100),
  /** Dos quais, ao vivo. */
  minLive: z.number().int().min(0).max(10_000).default(30),
  minDisciplinePct: z.number().min(0).max(100).default(90),
  /** Maior queda aceitável da conta de treino (% do pico). */
  maxDrawdownPct: z.number().min(1).max(100).default(20),
});
export type ReadinessParams = z.infer<typeof readinessParamsSchema>;
export const DEFAULT_READINESS: ReadinessParams = readinessParamsSchema.parse({});

export type ReadinessTrade = Pick<
  PaperPosition,
  'r' | 'initialStop' | 'plan' | 'riskPct' | 'stopMovedBack'
>;

export interface ReadinessInput {
  /** Trades fechados de TODAS as gerações da conta (reiniciar não apaga a evidência). */
  trades: readonly ReadinessTrade[];
  /** Conta na geração atual (dinheiro). */
  current: { initialBalance: number; totalBrl: number; taxBrl: number; maxDrawdownPct: number };
  /** CDI acumulado no período da geração atual (null: sem dados do BCB; undefined: carregando). */
  cdiAcc: number | null | undefined;
  maxRiskPct: number;
  params: ReadinessParams;
}

export interface ReadinessItem {
  key: 'amostra' | 'expectativa' | 'cdi' | 'disciplina' | 'queda';
  label: string;
  status: 'ok' | 'falta' | 'sem-dados';
  detail: string;
}

const overLimit = (t: ReadinessTrade, maxRiskPct: number) =>
  t.riskPct !== null && t.riskPct !== undefined && t.riskPct > maxRiskPct + 1e-9;

/**
 * Trade disciplinado: plano liberado, com stop, stop nunca movido para trás e risco dentro do limite.
 * Risco que não dá para medir (trade de antes de um reinício) não reprova, mas é contado à parte.
 */
export function isDisciplined(t: ReadinessTrade, maxRiskPct: number): boolean {
  return Boolean(
    t.plan?.released && t.initialStop !== null && !t.stopMovedBack && !overLimit(t, maxRiskPct),
  );
}

export function readiness(i: ReadinessInput): { items: ReadinessItem[]; ready: boolean } {
  const p = i.params;
  const n = i.trades.length;
  const rs = i.trades.map((t) => t.r).filter((r): r is number => r !== null);
  const expR = rs.length ? rs.reduce((s, x) => s + x, 0) / rs.length : null;
  const net = i.current.totalBrl - i.current.taxBrl;
  const ret = i.current.initialBalance > 0 ? net / i.current.initialBalance : 0;
  const disciplined = i.trades.filter((t) => isDisciplined(t, i.maxRiskPct)).length;
  const disc = n ? (disciplined / n) * 100 : null;
  const noPlan = i.trades.filter((t) => !t.plan?.released).length;
  const noStop = i.trades.filter((t) => t.initialStop === null).length;
  const back = i.trades.filter((t) => t.stopMovedBack).length;
  const overRisk = i.trades.filter((t) => overLimit(t, i.maxRiskPct)).length;
  const unknownRisk = i.trades.filter(
    (t) => t.initialStop !== null && (t.riskPct === null || t.riskPct === undefined),
  ).length;
  const pct = (v: number, d = 1) => `${formatNumber(v, d)}%`;

  const items: ReadinessItem[] = [
    {
      key: 'amostra',
      label: `Pelo menos ${p.minTrades} trades de treino (${p.minLive} ao vivo)`,
      status: n >= p.minTrades && n >= p.minLive ? 'ok' : 'falta',
      detail: `${n} de ${p.minTrades} (todos ao vivo: o replay ainda não existe, então só eles contam).`,
    },
    {
      key: 'expectativa',
      label: 'Expectativa positiva depois de custos e IR',
      status: expR === null ? 'falta' : expR > 0 && net > 0 ? 'ok' : 'falta',
      detail:
        expR === null
          ? 'Ainda não há trades com stop para medir em R.'
          : `${formatNumber(expR, 2)} R por trade (com custos); resultado da conta depois do IR simulado: ${formatBRL(net)}.`,
    },
    {
      key: 'cdi',
      label: 'Rendeu mais que o CDI no mesmo período',
      status:
        i.cdiAcc === null || i.cdiAcc === undefined
          ? 'sem-dados'
          : n > 0 && ret > i.cdiAcc
            ? 'ok'
            : 'falta',
      detail:
        i.cdiAcc === undefined
          ? 'Buscando o CDI no Banco Central…'
          : i.cdiAcc === null
            ? 'Sem dados do Banco Central para o período: comparação indisponível.'
            : `Treino ${pct(ret * 100, 2)} (depois do IR) × CDI ${pct(i.cdiAcc * 100, 2)} (antes do IR).`,
    },
    {
      key: 'disciplina',
      label: `Disciplina de pelo menos ${formatNumber(p.minDisciplinePct, 0)}%`,
      status: disc !== null && disc >= p.minDisciplinePct ? 'ok' : 'falta',
      detail:
        disc === null
          ? 'Ainda sem trades.'
          : `${pct(disc)} dos trades com plano completo, stop, sem stop para trás e risco até ${pct(i.maxRiskPct)}. ` +
            `Sem plano: ${noPlan}; sem stop: ${noStop}; stop para trás: ${back}; risco acima do limite: ${overRisk}` +
            (unknownRisk
              ? `; risco não medido (antes de reiniciar a conta): ${unknownRisk}.`
              : '.'),
    },
    {
      key: 'queda',
      label: `Maior queda da conta até ${formatNumber(p.maxDrawdownPct, 0)}%`,
      status: n > 0 && i.current.maxDrawdownPct <= p.maxDrawdownPct ? 'ok' : 'falta',
      detail: n ? `Maior queda: ${pct(i.current.maxDrawdownPct, 2)} do pico.` : 'Ainda sem trades.',
    },
  ];
  return { items, ready: items.every((x) => x.status === 'ok') };
}
