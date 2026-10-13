import { z } from 'zod';
import type { Delay, Market, VolumeQuality } from './market';
import type { FeedStatus } from './protocol';
import { isIntraday, timeframeSchema, type Timeframe } from './timeframes';

/**
 * Scanner multi-mercado (SPEC §14): tipos e schemas compartilhados entre servidor e navegador.
 * A lógica (varrer um ativo e aplicar filtros) fica só em `@radar/core` (`scanner/`).
 */

/** Limite de ativos por varredura (decisão nossa; a conta das cotas das fontes está nas DECISIONS). */
export const SCAN_MAX_SYMBOLS = 60;
/**
 * Agenda "a cada fechamento intradiário": só listas do usuário e no máximo 20 ativos acompanhados ao vivo
 * (o plano gratuito da Alpaca aceita 30 símbolos no WebSocket, divididos com gráficos, alertas e treino).
 */
export const SCAN_MAX_INTRADAY_SYMBOLS = 20;
/** Fechamentos guardados por ativo para o mini-gráfico. */
export const SCAN_SPARK_BARS = 60;
/** Topo de referência da queda: 52 candles da escala e 52 semanas (SPEC §8.8). */
export const SCAN_PEAK_BARS = 52;

export const SCAN_SETUP_IDS = [
  's91',
  's92',
  's93',
  'pullback',
  'consolidation',
  'elastic',
  'reflexivity',
] as const;
export type ScanSetupId = (typeof SCAN_SETUP_IDS)[number];

/** Estados de uma ocorrência ATIVA (encerradas não entram no scanner). */
export const SCAN_STATES = ['radar', 'armado', 'acionado'] as const;
export type ScanState = (typeof SCAN_STATES)[number];

export const TREND_VALUES = ['alta', 'baixa', 'lateral', 'indefinida'] as const;
export type TrendValue = (typeof TREND_VALUES)[number];

/** Direção da média pela primitiva de inclinação (SPEC §8.1) e `pa.flatSlope`. */
export const SLOPE_DIRS = ['subindo', 'descendo', 'plana'] as const;
export type SlopeDir = (typeof SLOPE_DIRS)[number];

/** Médias com inclinação na escala escolhida. */
export const SCAN_MAS = ['ema9', 'ema21', 'sma50', 'sma200'] as const;
export type ScanMa = (typeof SCAN_MAS)[number];
/** Médias com inclinação no semanal (as do filtro de reflexividade). */
export const WEEKLY_MAS = ['ema21', 'sma50'] as const;
export type WeeklyMa = (typeof WEEKLY_MAS)[number];
/** Médias candidatas a "média respeitada" (SPEC §9). */
export const RESPECT_MAS = ['ema9', 'ema21', 'sma50', 'sma100', 'sma200'] as const;
export type RespectMa = (typeof RESPECT_MAS)[number];

export const SCAN_MA_LABEL: Readonly<Record<RespectMa, string>> = {
  ema9: 'MME9',
  ema21: 'MME21',
  sma50: 'MMA50',
  sma100: 'MMA100',
  sma200: 'MMA200',
};

// ------------------------------------------------------------------ filtros

const slopeFilterSchema = z.discriminatedUnion('scale', [
  z.object({ scale: z.literal('tf'), ma: z.enum(SCAN_MAS), dir: z.enum(SLOPE_DIRS) }),
  z.object({ scale: z.literal('1w'), ma: z.enum(WEEKLY_MAS), dir: z.enum(SLOPE_DIRS) }),
]);
export type SlopeFilter = z.infer<typeof slopeFilterSchema>;

/**
 * Filtros COMBINÁVEIS (SPEC §14): a linha passa só se cumprir todos os que estiverem preenchidos.
 * Filtro ausente = não filtra. Sem dado para um filtro pedido, a linha não passa (nunca "passou" por
 * falta de dado).
 */
export const scanFiltersSchema = z.object({
  /** Algum setup da lista, ATIVO num dos estados, do lado pedido. */
  setup: z
    .object({
      ids: z.array(z.enum(SCAN_SETUP_IDS)).min(1).max(SCAN_SETUP_IDS.length),
      states: z.array(z.enum(SCAN_STATES)).min(1).max(3).default(['radar', 'armado', 'acionado']),
      side: z.enum(['buy', 'sell', 'any']).default('any'),
      /** Deixar de fora quem está contra a escala maior (aviso vermelho). */
      withHigher: z.boolean().default(false),
    })
    .optional(),
  trend: z.array(z.enum(TREND_VALUES)).min(1).max(4).optional(),
  adxMin: z.number().min(0).max(100).optional(),
  /** "Respeita uma destas médias". */
  respected: z.array(z.enum(RESPECT_MAS)).min(1).max(5).optional(),
  slopes: z
    .array(slopeFilterSchema)
    .max(SCAN_MAS.length + WEEKLY_MAS.length)
    .refine(
      (xs) => new Set(xs.map((x) => `${x.scale}:${x.ma}`)).size === xs.length,
      'cada média aparece uma vez por escala',
    )
    .optional(),
  /** Queda mínima desde o topo de 52 candles da escala ('tf') ou de 52 semanas ('52w'). Fração (0,5 = 50%). */
  minDrawdown: z
    .object({ ref: z.enum(['tf', '52w']), value: z.number().min(0.01).max(0.99) })
    .optional(),
  /** Volume do último candle ÷ média dos 21 anteriores. */
  minRelVolume: z.number().min(0).max(50).optional(),
  /** Fundamentos (SPEC §8.8): sem dado = "fundamentos não verificados", nunca passa. */
  fundamentals: z
    .object({
      /** Crescimento mínimo do LPA ao ano nos últimos 2 anos (0,2 = 20%). */
      minEpsGrowth: z.number().min(0).max(5).optional(),
      revenueNoDecline: z.literal(true).optional(),
    })
    .refine((f) => f.minEpsGrowth !== undefined || f.revenueNoDecline, 'escolha um critério')
    .optional(),
});
export type ScanFilters = z.infer<typeof scanFiltersSchema>;

/**
 * Filtro pronto "Distorção (reflexividade)" (SPEC §14): MME21 semanal descendo, MMA50 semanal descendo,
 * LPA crescendo ≥ 20% ao ano nos últimos 2 anos e queda ≥ 50% (topo de 52 semanas).
 */
export const DISTORTION_FILTERS: ScanFilters = {
  slopes: [
    { scale: '1w', ma: 'ema21', dir: 'descendo' },
    { scale: '1w', ma: 'sma50', dir: 'descendo' },
  ],
  minDrawdown: { ref: '52w', value: 0.5 },
  fundamentals: { minEpsGrowth: 0.2 },
};

// ------------------------------------------------------------------ universo, execução e agenda

export const SUGGESTED_UNIVERSE_IDS = ['b3', 'cripto', 'eua', 'sim'] as const;

export const scanUniverseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('watchlist'), id: z.number().int().positive() }),
  z.object({ kind: z.literal('suggested'), id: z.enum(SUGGESTED_UNIVERSE_IDS) }),
]);
export type ScanUniverse = z.infer<typeof scanUniverseSchema>;

export const scanRunInputSchema = z.object({
  universe: scanUniverseSchema,
  tf: timeframeSchema,
  filters: scanFiltersSchema.default({}),
});
export type ScanRunInput = z.infer<typeof scanRunInputSchema>;

/** off = só sob demanda; daily = a cada candle diário fechado; intraday = a cada fechamento intradiário. */
export const SCAN_SCHEDULES = ['off', 'daily', 'intraday'] as const;
export type ScanSchedule = (typeof SCAN_SCHEDULES)[number];

export const SCAN_SCHEDULE_LABEL: Readonly<Record<ScanSchedule, string>> = {
  off: 'Só quando eu mandar',
  daily: 'Todo dia, depois do fechamento',
  intraday: 'A cada candle fechado (só listas)',
};

export const savedScanInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    universe: scanUniverseSchema,
    tf: timeframeSchema,
    filters: scanFiltersSchema.default({}),
    schedule: z.enum(SCAN_SCHEDULES).default('off'),
  })
  .superRefine((v, ctx) => {
    if (v.schedule !== 'intraday') return;
    if (v.universe.kind !== 'watchlist')
      ctx.addIssue({
        code: 'custom',
        path: ['schedule'],
        message: 'A agenda a cada candle intradiário só vale para as suas listas.',
      });
    if (!isIntraday(v.tf))
      ctx.addIssue({
        code: 'custom',
        path: ['schedule'],
        message: 'A agenda a cada candle intradiário precisa de uma escala de 1 a 60 min.',
      });
  });
export type SavedScanInput = z.infer<typeof savedScanInputSchema>;

export type ScanTrigger = 'manual' | 'daily' | 'intraday';

// ------------------------------------------------------------------ resultado

export interface ScanFundamentals {
  /** Crescimento do LPA ao ano nos últimos 2 anos; null = não verificado. */
  epsGrowth2y: number | null;
  /** Receita sem queda; null = não verificado. */
  revenueNoDecline: boolean | null;
  source: string;
}

/** Ocorrência ATIVA de um setup no último candle fechado (mesmo motor do gráfico). */
export interface ScanSetupHit {
  setup: ScanSetupId;
  side: 'buy' | 'sell';
  state: ScanState;
  trigger: number | null;
  stop: number | null;
  target: number | null;
  entry: number | null;
  /** Aviso vermelho: compra com a escala maior em baixa (venda com ela em alta). */
  againstHigher: boolean;
  /** Horário do primeiro evento da ocorrência. */
  since: number;
  /** "Porquê" do último evento. */
  reason: string;
  notes: string[];
}

/** Análise de um ativo no último candle FECHADO (função pura `scanSymbol` do core). */
export interface ScanAnalysis {
  lastClose: number;
  /** Horário do último candle fechado (ADR-0006). */
  lastTime: number;
  /** Candles fechados usados. */
  bars: number;
  setups: ScanSetupHit[];
  /** Escala maior acompanhada pelo motor (vento a favor/contra); null = sem dados. */
  higher: { tfLabel: string; trend: TrendValue } | null;
  trend: TrendValue;
  adx: number | null;
  respected: { ma: RespectMa; hits: number; of: number } | null;
  slopes: Record<ScanMa, SlopeDir | null>;
  /** Semanal FECHADO (null = sem candles semanais). */
  weekly: { bars: number; lastTime: number; slopes: Record<WeeklyMa, SlopeDir | null> } | null;
  /** Queda desde o topo (fração ≥ 0): 52 candles da escala e 52 semanas; null = menos de 52 candles. */
  drawdown: { tf: number | null; w52: number | null };
  /** Volume do último ÷ média dos 21 anteriores; null = sem volume. */
  relVolume: number | null;
  fundamentals: ScanFundamentals | null;
  /** Últimos fechamentos (mini-gráfico). */
  spark: number[];
}

export type FilterCheckStatus = 'ok' | 'fail' | 'nodata' | 'unverified';

export interface FilterCheck {
  key: string;
  label: string;
  status: FilterCheckStatus;
  detail: string;
}

export interface FilterOutcome {
  pass: boolean;
  /**
   * Passa em tudo, menos nos fundamentos, que não puderam ser verificados (sem fonte ligada).
   * Mostrado à parte: "só a parte gráfica — fundamentos não verificados".
   */
  chartOnly: boolean;
  checks: FilterCheck[];
  /** Motivos de não passar (PT-BR). */
  reasons: string[];
}

/** Fonte, atraso e qualidade do volume de cada linha (SPEC §3.2). */
export interface ScanSourceInfo {
  label: string;
  delay: Delay;
  volume: VolumeQuality;
  liveVolume: VolumeQuality;
  adjusted: 'yes' | 'no' | 'unknown';
  simulated: boolean;
  status: FeedStatus;
  notes: string[];
}

export interface ScanRow {
  symbolId: string;
  symbol: string;
  name: string;
  market: Market | null;
  /** Casas decimais do preço (meta da fonte). */
  decimals: number;
  source: ScanSourceInfo | null;
  analysis: ScanAnalysis | null;
  /** Linha de erro: a fonte falhou ou faltam dados (nunca inventa). */
  error: string | null;
  /** Avisos sobre os dados desta linha (ex.: semanal indisponível). */
  notes: string[];
  scannedAt: number;
  trigger: ScanTrigger;
  /** Resultado dos filtros da varredura (calculado pelo core ao ler). */
  filter?: FilterOutcome;
}

export interface ScanConfig {
  universe: ScanUniverse;
  tf: Timeframe;
  filters: ScanFilters;
}

/** Último resultado de uma varredura (salva ou avulsa). Linhas de varreduras parciais são emendadas. */
export interface ScanSnapshot {
  /** Id da varredura salva (null = avulsa). */
  scanId: string | null;
  config: ScanConfig;
  universeLabel: string;
  rows: ScanRow[];
  /** Ativos do universo que ficaram de fora pelo limite. */
  truncated: number;
  /** Execução em andamento (startedAt null = na fila). */
  running: {
    trigger: ScanTrigger;
    startedAt: number | null;
    done: number;
    total: number;
    current: string | null;
  } | null;
  lastRun: {
    trigger: ScanTrigger;
    finishedAt: number;
    status: 'done' | 'error';
    error: string | null;
    symbols: number;
  } | null;
  updatedAt: number;
}

export interface SavedScan {
  id: string;
  name: string;
  config: ScanConfig;
  schedule: ScanSchedule;
  createdAt: number;
  updatedAt: number;
  /** Resumo do último resultado. */
  summary: {
    rows: number;
    pass: number;
    chartOnly: number;
    errors: number;
    updatedAt: number | null;
    running: boolean;
  };
}

export interface ScanUniverses {
  watchlists: { id: number; name: string; count: number }[];
  suggested: { id: (typeof SUGGESTED_UNIVERSE_IDS)[number]; label: string; count: number }[];
  limits: { maxSymbols: number; maxIntraday: number };
}
