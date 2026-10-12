import { z } from 'zod';
import { timeframeSchema } from './timeframes';

/** Setups que podem gerar alerta (mesmos ids de `packages/core/src/setups`). */
export const SETUP_IDS = [
  's91',
  's92',
  's93',
  'pullback',
  'consolidation',
  'elastic',
  'reflexivity',
] as const;
export const setupIdSchema = z.enum(SETUP_IDS);

export const CHANNELS = ['push', 'telegram', 'email'] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Readonly<Record<Channel, string>> = {
  push: 'Notificação no aparelho',
  telegram: 'Telegram',
  email: 'E-mail',
};

export const INDICATOR_RULES = [
  'ema-turn-up',
  'ema-turn-down',
  'close-below-bb',
  'close-above-bb',
  'adx-above',
  'adx-below',
  'close-cross-ma-up',
  'close-cross-ma-down',
] as const;
export type IndicatorRule = (typeof INDICATOR_RULES)[number];

export const INDICATOR_RULE_LABEL: Readonly<Record<IndicatorRule, string>> = {
  'ema-turn-up': 'MME virou para cima',
  'ema-turn-down': 'MME virou para baixo',
  'close-below-bb': 'Fechou abaixo da banda inferior de Bollinger',
  'close-above-bb': 'Fechou acima da banda superior de Bollinger',
  'adx-above': 'ADX passou para cima do nível',
  'adx-below': 'ADX caiu para baixo do nível',
  'close-cross-ma-up': 'Fechamento cruzou a média para cima',
  'close-cross-ma-down': 'Fechamento cruzou a média para baixo',
};

const priceCondition = z.object({
  kind: z.literal('price'),
  level: z.number().finite().positive(),
  direction: z.enum(['up', 'down']),
});

const drawingCondition = z.object({
  kind: z.literal('drawing'),
  drawingId: z.string().min(1).max(64),
  /** Linhas (horizontal, tendência, raio): cruzar. Zonas: entrar ou sair. */
  event: z.enum(['cross-up', 'cross-down', 'enter', 'exit']),
});

const indicatorCondition = z.object({
  kind: z.literal('indicator'),
  rule: z.enum(INDICATOR_RULES),
  /** Período da média/Bollinger/ADX conforme a regra. */
  period: z.number().int().min(2).max(500).default(9),
  ma: z.enum(['ema', 'sma']).default('ema'),
  stdDev: z.number().min(0.5).max(6).default(3),
  level: z.number().min(0).max(100).default(25),
});

const SETUP_STATES = ['radar', 'armado', 'acionado', 'encerrado'] as const;
const setupCondition = z.object({
  kind: z.literal('setup'),
  setups: z.array(setupIdSchema).min(1),
  states: z.array(z.enum(SETUP_STATES)).min(1).default(['armado', 'acionado']),
  sides: z
    .array(z.enum(['buy', 'sell']))
    .min(1)
    .default(['buy']),
});

const systemCondition = z.object({
  kind: z.literal('system'),
  /** A fonte de dados do ativo ficou com erro por mais de alguns minutos. */
  event: z.literal('source-down'),
});

export const alertConditionSchema = z.discriminatedUnion('kind', [
  priceCondition,
  drawingCondition,
  indicatorCondition,
  setupCondition,
  systemCondition,
]);
export type AlertCondition = z.infer<typeof alertConditionSchema>;
export type AlertKind = AlertCondition['kind'];

export const ALERT_KIND_LABEL: Readonly<Record<AlertKind, string>> = {
  price: 'Preço',
  drawing: 'Desenho',
  indicator: 'Indicador',
  setup: 'Setup',
  system: 'Sistema',
};

/** Campos que o usuário envia ao criar/editar. */
export const alertInputSchema = z
  .object({
    symbolId: z.string().min(3).max(64),
    tf: timeframeSchema,
    condition: alertConditionSchema,
    /** "no toque" (intrabar) ou "no fechamento do candle". */
    trigger: z.enum(['touch', 'close']).default('close'),
    channels: z.array(z.enum(CHANNELS)).max(3).default(['push']),
    /** once = desliga depois de disparar; every = rearma (com intervalo mínimo). */
    repeat: z.enum(['once', 'every']).default('once'),
    cooldownMin: z.number().int().min(1).max(10_080).default(15),
    enabled: z.boolean().default(true),
    note: z.string().max(280).default(''),
  })
  .refine(
    (a) => a.trigger === 'close' || a.condition.kind === 'price' || a.condition.kind === 'drawing',
    {
      message: 'Setups e indicadores só avaliam no fechamento do candle',
      path: ['trigger'],
    },
  );
export type AlertInput = z.infer<typeof alertInputSchema>;

export interface Alert extends AlertInput {
  id: string;
  createdAt: number;
  updatedAt: number;
  lastFiredAt: number | null;
  /** Observação do servidor (ex.: "o desenho foi apagado"). */
  status: string | null;
}

/** Resultado da entrega em cada canal: "ok", "silenciado" ou a mensagem de erro. */
export type DeliveryResult = Partial<Record<Channel, string>>;

export interface AlertFire {
  id: string;
  alertId: string | null;
  symbolId: string;
  tf: string;
  /** Quando disparou (UTC ms). */
  firedAt: number;
  /** Candle que provocou o disparo (UTC ms). */
  candleTime: number;
  title: string;
  body: string;
  url: string;
  delivery: DeliveryResult;
  silenced: boolean;
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');

/** Preferências de notificação (o token do Telegram nunca volta para o navegador). */
export const notifySettingsInputSchema = z.object({
  quietEnabled: z.boolean().default(false),
  quietStart: hhmm.default('22:00'),
  quietEnd: hhmm.default('07:00'),
  telegramToken: z
    .string()
    .regex(/^\d{5,16}:[A-Za-z0-9_-]{30,64}$/, 'token do BotFather inválido')
    .nullable()
    .optional(),
  telegramChatId: z
    .string()
    .regex(/^-?\d{1,20}$/)
    .nullable()
    .optional(),
  email: z.string().email().max(200).nullable().optional(),
});
export type NotifySettingsInput = z.infer<typeof notifySettingsInputSchema>;

export interface NotifySettings {
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  telegramConfigured: boolean;
  telegramChatId: string | null;
  email: string | null;
  /** O servidor tem SMTP configurado no .env? */
  emailAvailable: boolean;
  /** Chave pública VAPID para assinar o push neste navegador. */
  vapidPublicKey: string;
  pushDevices: { id: string; label: string; createdAt: number; lastOkAt: number | null }[];
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  label: z.string().max(80).default('Aparelho'),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
