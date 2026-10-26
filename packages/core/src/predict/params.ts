import { z } from 'zod';

/**
 * Parâmetros da previsão honesta (SPEC §23.2, ADR-0033). Números marcados com * são ARBITRÁRIOS
 * (nossos, não da SPEC) e ficam editáveis.
 */
export const predictParamsSchema = z.object({
  /** Horizontes em candles da escala aberta (*1, 5 e 20, exemplo da SPEC §23.2). */
  horizons: z.array(z.number().int().min(1).max(200)).min(1).max(5).default([1, 5, 20]),
  /**
   * Encolhimento: quantos "casos fictícios" puxam a taxa de uma situação rara para a taxa da situação
   * mais geral (*30, nossa). 0 = taxa crua.
   */
  shrink: z.number().min(0).max(1000).default(30),
  /** Mínimo de previsões conferidas para falar em vantagem (*30, o mesmo da leitura simples). */
  minCases: z.number().int().min(5).max(10_000).default(30),
  /** Candles de aquecimento antes da primeira previsão no histórico (*200: a MMA200 precisa deles). */
  warmup: z.number().int().min(0).max(5000).default(200),
});

export type PredictParams = z.infer<typeof predictParamsSchema>;
export const DEFAULT_PREDICT: PredictParams = predictParamsSchema.parse({});
