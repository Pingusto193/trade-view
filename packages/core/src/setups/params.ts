import { z } from 'zod';

/**
 * Parâmetros das primitivas e dos setups (SPEC §8). Os valores padrão marcados com * na SPEC são
 * ARBITRÁRIOS e devem ser calibrados no laboratório sem overfitting. Tudo é editável na interface.
 */
export const paParamsSchema = z.object({
  /** Fractal: candles de cada lado para confirmar topo/fundo (*2). */
  pivotN: z.number().int().min(1).max(10).default(2),
  /** Passo da inclinação da média: (MA[t] − MA[t−k]) / ATR14 (*5). */
  slopeLookback: z.number().int().min(1).max(50).default(5),
  /** |inclinação| abaixo disto = média plana (*0,15). */
  flatSlope: z.number().min(0).max(2).default(0.15),
  /** |inclinação| acima disto = acentuada (decisão nossa: 1,0). */
  steepSlope: z.number().min(0).max(10).default(1),
  /** Candle de força: corpo ≥ k × corpo médio dos 20 anteriores (*1,5). */
  strongBodyMult: z.number().min(1).max(5).default(1.5),
  /** Barra de ignição: corpo ≥ k × média (*2) e sombra contrária ≤ x da amplitude (*10%). */
  ignitionBodyMult: z.number().min(1).max(5).default(2),
  ignitionMaxShadow: z.number().min(0).max(0.5).default(0.1),
  /** Martelo: sombra inferior ≥ k × corpo (*2), superior ≤ x da amplitude (*25%). */
  hammerShadowMult: z.number().min(1).max(5).default(2),
  hammerMaxUpper: z.number().min(0).max(0.5).default(0.25),
  /** Doji: corpo ≤ x da amplitude (*10%). */
  dojiMaxBody: z.number().min(0).max(0.5).default(0.1),
  /** Volume "muito acima" (*1,5) e "estrondoso" (*2) da média de 21. */
  volHigh: z.number().min(1).max(5).default(1.5),
  volHuge: z.number().min(1).max(10).default(2),
  /** Falso rompimento: volta para dentro em até N candles (*2). */
  falseBreakBars: z.number().int().min(1).max(10).default(2),
  /** Rompimento só vale por fechamento (pavio não conta) — configurável. */
  breakoutByClose: z.boolean().default(true),
});
export type PaParams = z.infer<typeof paParamsSchema>;
export const DEFAULT_PA: PaParams = paParamsSchema.parse({});

const exitSchema = z.object({
  /** 'fixed' = stop e alvo em R; 'dynamic' = condução (sem alvo). */
  mode: z.enum(['fixed', 'dynamic']).default('fixed'),
  targetR: z.number().min(0.5).max(10).default(2),
});

export const setup91Schema = z.object({
  enabled: z.boolean().default(true),
  /** Filtro de contexto: só comprar com a MMA50 subindo (Experimento E1 liga/desliga). */
  trendFilter: z.boolean().default(true),
  /** Não operar em mercado lateral: ADX abaixo disto (*20) ou MMA50 plana. */
  adxMin: z.number().min(0).max(60).default(20),
  stopMode: z.enum(['signal-low', 'prior-swing']).default('signal-low'),
  exit: exitSchema.default({ mode: 'fixed', targetR: 2 }),
  /** Venda espelhada — não descrita nos vídeos. */
  allowSell: z.boolean().default(false),
  /** Decisão nossa: se não romper no candle seguinte e a MME9 seguir subindo, o gatilho passa
   * para a máxima do novo candle. */
  trailTrigger: z.boolean().default(true),
});

export const setup92Schema = z.object({
  enabled: z.boolean().default(true),
  exit: exitSchema.default({ mode: 'fixed', targetR: 2 }),
  allowSell: z.boolean().default(false),
});

export const setup93Schema = z.object({
  enabled: z.boolean().default(true),
  exit: exitSchema.default({ mode: 'fixed', targetR: 2 }),
  /** Lacuna do vídeo: os dois fechamentos precisam ser consecutivos? Padrão nosso: sim. */
  consecutive: z.boolean().default(true),
  allowSell: z.boolean().default(false),
});

export const pullbackSchema = z.object({
  enabled: z.boolean().default(true),
  /** Média do recuo: 'auto' usa a média que o ativo respeita (contexto); senão a escolhida. */
  ma: z.enum(['auto', 'ema9', 'ema21', 'sma50']).default('auto'),
  /** "Perto da média": mínima até k × ATR14 da média (*0,5). */
  nearAtr: z.number().min(0).max(3).default(0.5),
  /** Recuo saudável: amplitude média do recuo < k × a do impulso (*0,7). */
  smallerRangeRatio: z.number().min(0.1).max(2).default(0.7),
  /** Usar os sinais de "recuo saudável" como filtro (E4 compara com e sem). */
  requireHealthy: z.boolean().default(false),
  stopMode: z.enum(['trigger-low', 'pullback-low']).default('pullback-low'),
  exit: exitSchema.default({ mode: 'fixed', targetR: 2 }),
  /** Validade do setup após armar (candles). Decisão nossa. */
  expiryBars: z.number().int().min(1).max(20).default(5),
});

export const consolidationSchema = z.object({
  enabled: z.boolean().default(true),
  minBars: z.number().int().min(3).max(100).default(8),
  maxBars: z.number().int().min(5).max(200).default(40),
  /** Amplitude máxima da caixa: k × ATR14 medido antes da caixa (*3). */
  maxRangeAtr: z.number().min(0.5).max(10).default(3),
  /** Contração: largura da Bollinger 20/2 no menor quintil dos últimos N candles (*120). */
  squeezeLookback: z.number().int().min(20).max(500).default(120),
  squeezeQuantile: z.number().min(0.05).max(0.5).default(0.2),
  /** Volume do rompimento ≥ k × média (*1,5). E5 compara com e sem. */
  breakoutVolMult: z.number().min(0).max(5).default(1.5),
  requireVolume: z.boolean().default(true),
  /** Corpo do candle de rompimento ≥ k × corpo médio (decisão nossa: 1,2). */
  breakoutBodyMult: z.number().min(0).max(5).default(1.2),
  stopMode: z.enum(['box-low', 'breakout-low']).default('box-low'),
  /** Entrada: 'breakout' (no rompimento) ou 'retest' (no reteste) — E5 compara. */
  entry: z.enum(['breakout', 'retest']).default('breakout'),
  exit: exitSchema.default({ mode: 'fixed', targetR: 2 }),
});

export const elasticSchema = z.object({
  enabled: z.boolean().default(true),
  /** Bollinger de 20 e 3 desvios (fixo pela definição do setup; editável para estudo). */
  bbPeriod: z.number().int().min(5).max(100).default(20),
  bbStdDev: z.number().min(1).max(5).default(3),
  /** Expira em N candles sem acionar (*5). */
  expiryBars: z.number().int().min(1).max(20).default(5),
  /** Confirmação opcional: martelo ou candle de força no candle que arma. */
  requireConfirmation: z.boolean().default(false),
  allowSell: z.boolean().default(true),
  /** Parcial opcional em 1R. */
  partialAt1R: z.boolean().default(false),
});

export const reflexivitySchema = z.object({
  enabled: z.boolean().default(true),
  /** Queda mínima desde o topo (*50%). */
  minDrawdown: z.number().min(0.1).max(0.95).default(0.5),
  /** Topo de referência: 52 semanas ou histórico. */
  peak: z.enum(['52w', 'all']).default('52w'),
  /** Crescimento mínimo do LPA nos últimos 2 anos (*20% a.a.). */
  minEpsGrowth: z.number().min(0).max(2).default(0.2),
});

export const setupParamsSchema = z.object({
  pa: paParamsSchema.default(DEFAULT_PA),
  s91: setup91Schema.default(setup91Schema.parse({})),
  s92: setup92Schema.default(setup92Schema.parse({})),
  s93: setup93Schema.default(setup93Schema.parse({})),
  pullback: pullbackSchema.default(pullbackSchema.parse({})),
  consolidation: consolidationSchema.default(consolidationSchema.parse({})),
  elastic: elasticSchema.default(elasticSchema.parse({})),
  reflexivity: reflexivitySchema.default(reflexivitySchema.parse({})),
});
export type SetupParams = z.infer<typeof setupParamsSchema>;
export const DEFAULT_SETUP_PARAMS: SetupParams = setupParamsSchema.parse({});
