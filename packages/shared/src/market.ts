import { z } from 'zod';
import { timeframeSchema } from './timeframes';

/**
 * Candle (vela).
 *
 * Convenção de tempo (ADR-0006):
 * - Escalas intradiárias: `time` é o instante UTC (ms) da abertura do candle.
 * - Diário, semanal e mensal: `time` é a meia-noite UTC da **data de pregão** (data local da bolsa)
 *   do primeiro dia do período. Ex.: o diário de 10/10/2026 da B3 tem `time = Date.UTC(2026, 9, 10)`.
 */
export const candleSchema = z.object({
  time: z.number().int(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
});
export type Candle = z.infer<typeof candleSchema>;

export const MARKETS = ['crypto', 'us', 'b3', 'forex'] as const;
export type Market = (typeof MARKETS)[number];
export const marketSchema = z.enum(MARKETS);

export const MARKET_LABEL: Readonly<Record<Market, string>> = {
  crypto: 'Cripto',
  us: 'Ações EUA',
  b3: 'B3',
  forex: 'Forex',
};

/** Qualidade do volume informado pela fonte (SPEC §3.2 e §6). */
export const VOLUME_QUALITY = ['complete', 'partial', 'exchange-only', 'tick', 'none'] as const;
export type VolumeQuality = (typeof VOLUME_QUALITY)[number];

export const VOLUME_QUALITY_LABEL: Readonly<Record<VolumeQuality, string>> = {
  complete: 'Volume completo',
  partial: 'Volume parcial',
  'exchange-only': 'Volume só desta exchange',
  tick: 'Tick volume (não é volume negociado)',
  none: 'Sem volume',
};

/** Atraso dos dados. */
export const delaySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('realtime') }),
  z.object({ kind: z.literal('delayed'), minutes: z.number().positive() }),
  z.object({ kind: z.literal('eod') }),
  z.object({ kind: z.literal('simulated') }),
]);
export type Delay = z.infer<typeof delaySchema>;

export function delayLabel(d: Delay): string {
  switch (d.kind) {
    case 'realtime':
      return 'Tempo real';
    case 'delayed':
      return `Atrasado ~${d.minutes} min`;
    case 'eod':
      return 'Fechamento anterior';
    case 'simulated':
      return 'DADOS SIMULADOS';
  }
}

/**
 * Sessão de negociação em horário local da bolsa.
 * - Pregão diário: `days` + `open`/`close` (+ `preOpen`).
 * - 24h: sem `open`/`close` (cripto: todos os dias).
 * - Janela semanal contínua (forex 24/5): `weekly`, ex.: domingo 17:00 → sexta 17:00 em Nova York.
 */
export const sessionSchema = z.object({
  timezone: z.string(),
  /** Dias da semana de pregão (0 = domingo). */
  days: z.array(z.number().int().min(0).max(6)),
  /** "HH:MM" local; ausente = 24h. */
  open: z.string().optional(),
  close: z.string().optional(),
  preOpen: z.string().optional(),
  weekly: z
    .object({
      openDay: z.number().int().min(0).max(6),
      openTime: z.string(),
      closeDay: z.number().int().min(0).max(6),
      closeTime: z.string(),
    })
    .optional(),
  /** Feriados (AAAA-MM-DD, data local) sem pregão. */
  holidays: z.array(z.string()).optional(),
});
export type Session = z.infer<typeof sessionSchema>;

/** Metadados de um ativo (SPEC §6 — getMeta). */
export const symbolMetaSchema = z.object({
  /** Identificador único no Radar: "<fonte>:<código>", ex.: "binance:BTCUSDT". */
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  market: marketSchema,
  source: z.string(),
  sourceLabel: z.string(),
  currency: z.string(),
  tickSize: z.number().positive(),
  /** Lote padrão (B3: 100). */
  lotSize: z.number().positive(),
  /** Menor quantidade negociável (B3 fracionário: 1; cripto: ex. 0.00001). */
  minQty: z.number().positive(),
  qtyStep: z.number().positive(),
  priceDecimals: z.number().int().nonnegative(),
  /** Valor monetário de 1 ponto de preço por contrato (futuros/forex). Ações: 1. */
  pointValue: z.number().positive(),
  delay: delaySchema,
  volume: z.enum(VOLUME_QUALITY),
  /** Volume ao vivo pode ter qualidade diferente do histórico (ex.: Alpaca IEX). */
  liveVolume: z.enum(VOLUME_QUALITY),
  session: sessionSchema,
  timeframes: z.array(timeframeSchema),
  /** A série histórica é ajustada por proventos e desdobramentos? */
  adjusted: z.enum(['yes', 'no', 'unknown']),
  notes: z.array(z.string()).default([]),
});
export type SymbolMeta = z.infer<typeof symbolMetaSchema>;

export const symbolSearchResultSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  market: marketSchema,
  sourceLabel: z.string(),
});
export type SymbolSearchResult = z.infer<typeof symbolSearchResultSchema>;
