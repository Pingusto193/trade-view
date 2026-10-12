import type { Timeframe } from '@radar/shared';
import type { Side } from './fills';
import type { PaParams } from './params';
import type { PivotTracker } from './pivots';

export type SetupId =
  's91' | 's92' | 's93' | 'pullback' | 'consolidation' | 'elastic' | 'reflexivity';

export const SETUP_LABEL: Readonly<Record<SetupId, string>> = {
  s91: 'Setup 9.1',
  s92: 'Setup 9.2',
  s93: 'Setup 9.3',
  pullback: 'Recuo à média',
  consolidation: 'Rompimento de consolidação',
  elastic: 'Elástico (Bollinger 3 desvios)',
  reflexivity: 'Reflexividade (distorção)',
};

/** Ciclo de vida (SPEC §8): radar → armado → acionado → encerrado. */
export type SetupState = 'radar' | 'armado' | 'acionado' | 'encerrado';

export const STATE_LABEL: Readonly<Record<SetupState, string>> = {
  radar: 'Radar',
  armado: 'Armado',
  acionado: 'Acionado',
  encerrado: 'Encerrado',
};

export type ExitKind =
  'stop' | 'alvo' | 'saida-dinamica' | 'desarme' | 'expirou' | 'cancelado' | 'invalidado';

export const EXIT_LABEL: Readonly<Record<ExitKind, string>> = {
  stop: 'stop',
  alvo: 'alvo',
  'saida-dinamica': 'saída dinâmica',
  desarme: 'desarmado',
  expirou: 'expirou',
  cancelado: 'cancelado',
  invalidado: 'invalidado',
};

/** Evento de setup: tudo registra preço, horário, motivo e parâmetros (SPEC §8). */
export interface SetupEvent {
  /** Identifica a ocorrência (todas as fases do mesmo setup compartilham o id). */
  id: string;
  setup: SetupId;
  side: Side;
  state: SetupState;
  index: number;
  time: number;
  /** Preço relevante do evento (gatilho, execução ou saída). */
  price: number | null;
  /** Explicação em PT-BR (o "porquê"). */
  reason: string;
  trigger?: number;
  stop?: number;
  target?: number | null;
  entry?: number;
  entryIndex?: number;
  exit?: ExitKind;
  /** Resultado em R (só no encerramento após acionado). */
  resultR?: number;
  /** Saída parcial: fração da posição realizada em `price` (ex.: 0,5 = metade em 1R). */
  partial?: number;
  /** Pontuação (recuo à média). */
  score?: number;
  notes?: string[];
  /**
   * Aviso vermelho (SPEC §9): compra com a escala maior em baixa (ou venda com ela em alta). O texto do
   * aviso vai em `notes`.
   */
  againstHigher?: boolean;
  /** Índices de candles que justificam o evento (para destacar no gráfico). */
  refs?: number[];
  params?: unknown;
}

/** Resumo do contexto da escala maior, quando disponível (vento a favor/contra). */
export interface HigherContext {
  trend: 'alta' | 'baixa' | 'lateral' | 'indefinida';
  tfLabel: string;
}

/** Fundamentos (Fase 7). Nulo = não verificado. */
export interface Fundamentals {
  epsGrowth2y: number | null;
  revenueNoDecline: boolean | null;
  source: string;
}

export interface StepContext {
  pa: PaParams;
  /** Escala do gráfico (alguns setups só valem em certas escalas, ex.: reflexividade no semanal). */
  tf?: Timeframe;
  pivots: PivotTracker;
  /** Tendência do último candle FECHADO da escala maior (null = sem dados). */
  higher?: HigherContext | null;
  /** Média que o ativo respeita neste candle (mesma regra do painel, só com fundos já confirmados). */
  respectedMa?: 'ema9' | 'ema21' | 'sma50' | 'sma100' | 'sma200' | null;
  fundamentals?: Fundamentals | null;
}
