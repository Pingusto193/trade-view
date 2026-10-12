import { z } from 'zod';
import { candleSchema, symbolMetaSchema } from './market';
import { timeframeSchema } from './timeframes';

/** Estado de uma fonte de dados, sempre visível ao usuário (SPEC §3.1). */
export const feedStateSchema = z.enum([
  'ok',
  'connecting',
  'stale',
  'error',
  'rate-limited',
  'not-configured',
  'market-closed',
]);
export type FeedState = z.infer<typeof feedStateSchema>;

export const feedStatusSchema = z.object({
  state: feedStateSchema,
  message: z.string().optional(),
  /** Momento (UTC ms) do último dado válido recebido. */
  lastValidAt: z.number().optional(),
});
export type FeedStatus = z.infer<typeof feedStatusSchema>;

export const FEED_STATE_LABEL: Readonly<Record<FeedState, string>> = {
  ok: 'Conectado',
  connecting: 'Conectando…',
  stale: 'Sem atualização recente',
  error: 'Erro na fonte',
  'rate-limited': 'Limite de requisições atingido',
  'not-configured': 'Fonte não configurada',
  'market-closed': 'Mercado fechado',
};

// ---------- WebSocket: navegador → servidor ----------
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), id: z.string(), tf: timeframeSchema }),
  z.object({ type: z.literal('unsubscribe'), id: z.string(), tf: timeframeSchema }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------- WebSocket: servidor → navegador ----------
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('candle'),
    id: z.string(),
    tf: timeframeSchema,
    candle: candleSchema,
    /** true = candle fechado (definitivo); false = candle em formação. */
    closed: z.boolean(),
  }),
  z.object({
    type: z.literal('status'),
    id: z.string(),
    tf: timeframeSchema,
    status: feedStatusSchema,
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('pong') }),
  /** Algo mudou em outro aparelho: o navegador recarrega o tópico (desenhos, listas, preferências). */
  z.object({
    type: z.literal('sync'),
    topic: z.enum(['drawings', 'watchlists', 'presets', 'prefs', 'alerts']),
    symbolId: z.string().optional(),
    origin: z.string().optional(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// ---------- REST ----------
export const candlesQuerySchema = z.object({
  id: z.string().min(1),
  tf: timeframeSchema,
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(20_000).optional(),
});
export type CandlesQuery = z.infer<typeof candlesQuerySchema>;

export const candlesResponseSchema = z.object({
  meta: symbolMetaSchema,
  candles: z.array(candleSchema),
  status: feedStatusSchema,
  /** O último candle da lista ainda está em formação? */
  lastCandleOpen: z.boolean(),
});
export type CandlesResponse = z.infer<typeof candlesResponseSchema>;
