import { z } from 'zod';
import { timeframeSchema } from './timeframes';

/** Preferências do usuário guardadas no servidor (SPEC §17: nada importante só no navegador). */
export const prefsSchema = z.object({
  chartType: z.enum(['candles', 'heikin', 'line']).default('candles'),
  presetId: z.string().max(64).default('padrao-do-canal'),
  fractalId: z.string().max(64).default('swing-diario'),
  upColor: z.string().max(32).default('#22c55e'),
  downColor: z.string().max(32).default('#ef4444'),
  lastSymbol: z.string().max(60).optional(),
  lastTf: timeframeSchema.optional(),
  /** Capital e risco usados na ferramenta de posição e na calculadora (SPEC §11). */
  capital: z.number().positive().default(10_000),
  riskPct: z.number().positive().max(10).default(1),
  /** Limite máximo de risco por trade (aviso acima de 2%; bloqueio de confirmação acima do limite). */
  maxRiskPct: z.number().positive().max(10).default(2),
});
export type Prefs = z.infer<typeof prefsSchema>;
export const DEFAULT_PREFS: Prefs = prefsSchema.parse({});

export const watchlistSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1).max(60),
  items: z.array(z.string().min(3).max(60)).max(500),
});
export type Watchlist = z.infer<typeof watchlistSchema>;
