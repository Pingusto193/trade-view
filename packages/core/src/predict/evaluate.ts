import type { Candle, Timeframe } from '@radar/shared';
import { DEFAULT_SETUP_PARAMS, type SetupParams } from '../setups/params';
import { BaseRateModel, type Estimate } from './baserate';
import { FeatureTracker } from './features';
import { walkForwardModel, type ModelHorizon } from './model';
import { signalBacktest, type MoneyMeta, type SignalBacktest } from './money';
import { DEFAULT_PREDICT, type PredictParams } from './params';
import { scorePredictions, type ScoredPrediction, type Scoreboard } from './score';
import { SituationTracker, type Situation } from './situation';

export interface HorizonReport {
  horizon: number;
  /** Probabilidade de agora (último candle fechado). */
  current: Estimate;
  /**
   * "Histórico de acerto" da regra no passado deste ativo, FORA DA AMOSTRA: em cada ponto a regra só
   * conhecia os casos já conferidos; pontos sem sobreposição (um a cada `horizon` candles).
   */
  history: Scoreboard;
  /** As previsões conferidas desse histórico (para gráficos e para o backtest do sinal). */
  points: ScoredPrediction[];
  /** Camada 2: regressão logística em walk-forward com purga e embargo (ADR-0034). */
  model: ModelHorizon;
  /**
   * Resultado em dinheiro de operar cada camada fora da amostra, depois de custos e IR (null sem os
   * dados do ativo). O CDI do período vem do servidor (BCB).
   */
  money: { base: SignalBacktest; model: SignalBacktest } | null;
}

export interface PredictionReport {
  time: number;
  situation: Situation;
  timeframes: [Timeframe, Timeframe | null, Timeframe | null];
  horizons: HorizonReport[];
}

/**
 * Camada 1 completa sobre o histórico: situação de cada candle, estimativa de agora para cada horizonte e
 * o histórico de acerto fora da amostra. `candles` = só candles FECHADOS. null se não houver candles
 * suficientes para aquecer os indicadores.
 */
export function predictReport(
  candles: readonly Candle[],
  opts: {
    tf: Timeframe;
    tz: string;
    tick?: number;
    setupParams?: SetupParams;
    params?: PredictParams;
    /** Dados do ativo para o resultado em dinheiro (valor do ponto, lote, mercado). */
    meta?: MoneyMeta;
    /** Notícias associadas ao ativo antes de cada instante (feature da camada 2; ausente = 0). */
    newsAt?: (time: number) => number;
  },
): PredictionReport | null {
  const params = opts.params ?? DEFAULT_PREDICT;
  if (candles.length <= params.warmup) return null;
  const tracker = new SituationTracker(opts);
  const features = new FeatureTracker((opts.setupParams ?? DEFAULT_SETUP_PARAMS).pa, opts.newsAt);
  const feats: (number[] | null)[] = [];
  const models = params.horizons.map((h) => new BaseRateModel(h, params.shrink));
  const scored: ScoredPrediction[][] = params.horizons.map(() => []);
  const nextEval = params.horizons.map(() => params.warmup);
  const last = candles.length - 1;
  let sit: Situation | null = null;
  for (let t = 0; t <= last; t++) {
    const c = candles[t] as Candle;
    sit = tracker.push(c);
    feats.push(features.push(c, sit, tracker.engine.series));
    for (let k = 0; k < models.length; k++) {
      const m = models[k]!;
      m.push(c.close, sit);
      const h = m.horizon;
      if (t < (nextEval[k] as number) || t + h > last) continue;
      const e = m.estimate();
      scored[k]!.push({
        time: c.time,
        p: e.p,
        alwaysUpP: e.alwaysUpP,
        persistUp: e.persistUp,
        up: (candles[t + h] as Candle).close > c.close,
      });
      nextEval[k] = t + h;
    }
  }
  const closes = candles.map((c) => c.close);
  const times = candles.map((c) => c.time);
  return {
    time: (candles[last] as Candle).time,
    situation: sit as Situation,
    timeframes: tracker.timeframes,
    horizons: models.map((m, k) => {
      const model = walkForwardModel(feats, closes, times, m.horizon, params);
      return {
        horizon: m.horizon,
        current: m.estimate(),
        history: scorePredictions(scored[k]!, params.minCases),
        points: scored[k]!,
        model,
        money: opts.meta
          ? {
              base: signalBacktest(candles, scored[k]!, m.horizon, opts.meta, params),
              model: signalBacktest(candles, model.points, m.horizon, opts.meta, params),
            }
          : null,
      };
    }),
  };
}
