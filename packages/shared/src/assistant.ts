import { z } from 'zod';

/**
 * Assistente com IA (SPEC §16, opcional e DESLIGADO por padrão). Usa a chave da API da Anthropic do
 * próprio usuário, guardada só no servidor (criptografada). Modelo e preços vêm da configuração, nunca
 * fixos no código (DATA_SOURCES §17).
 */
export const assistantSettingsInputSchema = z.object({
  enabled: z.boolean(),
  model: z.string().trim().min(3).max(80),
  monthlyLimitUsd: z.number().min(0.5).max(1000),
  /** Preço em US$ por milhão de tokens (entrada e saída), para a estimativa de custo. */
  priceInPerMTok: z.number().min(0).max(1000),
  priceOutPerMTok: z.number().min(0).max(1000),
  /** Só ao gravar uma chave nova; vazio = mantém a atual. */
  apiKey: z.string().trim().min(20).max(300).optional(),
  /** Apagar a chave guardada. */
  clearKey: z.boolean().optional(),
});
export type AssistantSettingsInput = z.infer<typeof assistantSettingsInputSchema>;

export interface AssistantSettings {
  enabled: boolean;
  model: string;
  monthlyLimitUsd: number;
  priceInPerMTok: number;
  priceOutPerMTok: number;
  /** Só os 4 últimos caracteres (a chave nunca volta ao navegador). */
  keyHint: string | null;
  month: string;
  spentUsd: number;
  requests: number;
}

/** Limite do contexto da tela enviado junto com a pergunta (caracteres de JSON). */
export const ASSISTANT_CONTEXT_MAX = 30_000;

export const assistantAskSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  /** Tela de onde veio a pergunta (gráfico, laboratório, diário…). */
  screen: z.string().max(40),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type AssistantAsk = z.infer<typeof assistantAskSchema>;

export interface AssistantAnswer {
  text: string;
  /** Modelo que respondeu (pode ser o de reserva, se o principal recusou). */
  model: string;
  costUsd: number;
  spentUsd: number;
  monthlyLimitUsd: number;
  refused: boolean;
}
