import { z } from 'zod';
import { tradePlanSchema } from './paper';
import { timeframeSchema } from './timeframes';

/** Replay (SPEC §13): treinar no passado, candle a candle, com o futuro escondido. */
export const REPLAY_WARMUP = 250;
/** Mínimo de candles DEPOIS do início para valer a sessão. */
export const REPLAY_MIN_AHEAD = 60;
/** Máximo de candles revelados de uma vez. */
export const REPLAY_MAX_STEP = 50;

export const replayCreateSchema = z.object({
  /** 'sorteio' = ativo e data sorteados e escondidos até o fim (para não lembrar o que aconteceu). */
  mode: z.enum(['sorteio', 'escolha']),
  symbolId: z.string().min(3).max(64).optional(),
  tf: timeframeSchema.default('1d'),
  /** Início do replay (UTC ms); sem data = sorteada. */
  date: z.number().int().optional(),
  capital: z.number().min(100).max(1_000_000_000).default(10_000),
  /** Câmbio manual (R$ por dólar) se não houver cotação agora. */
  fxManual: z.number().positive().max(1000).optional(),
});
export type ReplayCreate = z.infer<typeof replayCreateSchema>;

const px = z.number().positive().finite();
export const replayOrderSchema = z.object({
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit', 'stop']),
  qty: z.number().positive().finite(),
  price: px.nullable().default(null),
  stop: px.nullable().default(null),
  target: px.nullable().default(null),
  plan: tradePlanSchema.nullable().default(null),
});
export type ReplayOrderInput = z.infer<typeof replayOrderSchema>;

export const replayMoveSchema = z.object({
  stop: px.nullable().optional(),
  target: px.nullable().optional(),
  confirmMovedBack: z.boolean().optional(),
});
export type ReplayMoveInput = z.infer<typeof replayMoveSchema>;
