import { z } from 'zod';
import { SETUP_IDS } from './alerts';
import { timeframeSchema } from './timeframes';

/** Laboratório (SPEC §12): pedido de backtest de um ativo. */
export const labRunInputSchema = z.object({
  symbolId: z.string().min(3).max(64),
  tf: timeframeSchema,
  setups: z.array(z.enum(SETUP_IDS)).min(1),
  /** Parâmetros dos setups (validados no servidor pelo schema do core). */
  params: z.record(z.string(), z.unknown()).optional(),
  capital: z.number().min(100).max(1_000_000_000).default(10_000),
  riskPct: z.number().positive().max(10).default(1),
  /** Quantos candles para trás (o máximo que a fonte tiver, até 10 mil). */
  bars: z.number().int().min(100).max(10_000).default(2500),
  /** Fração inicial do período usada como "treino" (o resto é o teste fora da amostra). */
  trainFraction: z.number().min(0.5).max(0.9).default(0.7),
  /** Incluir vendas (apostar na queda). Desligado: aluguel/margem ainda não são simulados. */
  allowShort: z.boolean().default(false),
  costs: z
    .object({
      commissionPerOrder: z.number().min(0),
      feePct: z.number().min(0).max(0.05),
      slippageTicks: z.number().int().min(0).max(100),
      spreadPct: z.number().min(0).max(0.05),
    })
    .optional(),
});
export type LabRunInput = z.infer<typeof labRunInputSchema>;
export type LabRunDraft = z.input<typeof labRunInputSchema>;

export interface LabMetrics {
  trades: number;
  wins: number;
  winRate: number | null;
  payoff: number | null;
  expectancyR: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  totalReturn: number;
  cagr: number | null;
  maxDrawdown: number;
  maxDrawdownDays: number;
  longestLosingStreak: number;
  exposure: number;
  avgBarsInTrade: number | null;
  positiveMonths: number | null;
  fees: number;
  tax: number | null;
  totalReturnAfterTax: number | null;
  sample: 'inconclusivo' | 'evidência fraca' | 'amostra razoável';
}

export interface LabTrade {
  setup: string;
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  qty: number;
  pnl: number;
  r: number;
  fees: number;
  exitKind: string;
  againstHigher: boolean;
}

export type LabVerdict =
  'inconclusivo' | 'evidência fraca' | 'reprovado' | 'promissor' | 'aprovado';

export interface LabRun {
  id: string;
  createdAt: number;
  input: LabRunInput;
  symbol: string;
  currency: string;
  dataNotes: string[];
  from: number;
  to: number;
  bars: number;
  metrics: LabMetrics;
  train: LabMetrics;
  test: LabMetrics;
  cut: number;
  verdict: { label: LabVerdict; reasons: string[] };
  buyHold: number;
  cdi: { acc: number } | null;
  monteCarlo: {
    runs: number;
    drawdown: { p5: number; p50: number; p95: number };
    finalReturn: { p5: number; p50: number; p95: number };
    probLoss: { at: number; p: number }[];
  };
  sensitivity: {
    param: string;
    values: { value: number; expectancyR: number | null; trades: number }[];
  }[];
  /** Walk-forward do número "*" principal do 1º setup (null se o setup não tiver). */
  walkForward: {
    param: string;
    folds: {
      trainFrom: number;
      trainTo: number;
      testFrom: number;
      testTo: number;
      chosen: number | null;
      trainExpectancyR: number | null;
      testTrades: number;
      testExpectancyR: number | null;
    }[];
    oosTrades: number;
    oosExpectancyR: number | null;
  } | null;
  equity: { time: number; equity: number }[];
  monthly: { month: string; pnl: number }[];
  rHistogram: { from: number; to: number; count: number }[];
  trades: LabTrade[];
  skipped: Record<string, number>;
  /** Quantas variações deste ativo + setups você já testou (incluindo esta). */
  attempts: number;
}

export interface LabRunSummary {
  id: string;
  createdAt: number;
  symbolId: string;
  tf: string;
  setups: string[];
  trades: number;
  expectancyR: number | null;
  verdict: LabVerdict;
}
