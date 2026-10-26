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
  // ---- camada 2 (etapa 3, ADR-0034)
  /** Regularização L2 da regressão logística, nas features padronizadas (*1, nossa). */
  l2: z.number().min(0).max(1000).default(1),
  /** Reajusta o modelo a cada N candles no walk-forward (*500, nossa: custo × atualidade). */
  refitEvery: z.number().int().min(1).max(10_000).default(500),
  /**
   * Embargo: candles extras entre o fim dos rótulos de treino e o ponto previsto, além da purga de
   * `horizonte` candles (*10, nossa).
   */
  embargo: z.number().int().min(0).max(1000).default(10),
  /** Mínimo de casos de treino para ajustar o modelo (*200, nossa). */
  minTrain: z.number().int().min(20).max(100_000).default(200),
  // ---- resultado em dinheiro do sinal
  /** Só opera quando a probabilidade se afasta de 50% por pelo menos isto (*0,05 = 5 pp, nossa). */
  margin: z.number().min(0).max(0.45).default(0.05),
  /** Vender quando a probabilidade for baixa (futuros, forex, cripto); ações: só compra. */
  allowShort: z.boolean().default(false),
  /** Capital do backtest do sinal (na moeda do ativo; *10.000, o mesmo do treino). */
  capital: z.number().positive().default(10_000),
});

export type PredictParams = z.infer<typeof predictParamsSchema>;
export const DEFAULT_PREDICT: PredictParams = predictParamsSchema.parse({});
