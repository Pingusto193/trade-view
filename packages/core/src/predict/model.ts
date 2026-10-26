import { scorePredictions, type ScoredPrediction, type Scoreboard } from './score';
import { FEATURE_NAMES, type FeatureName } from './features';
import { fitLogistic, predictLogistic, type LogisticModel } from './logistic';
import { DEFAULT_PREDICT, type PredictParams } from './params';

export interface ModelCurrent {
  /** Probabilidade de fechar mais alto daqui a `horizon` candles, pelo modelo de agora. */
  p: number;
  /** Casos de treino usados. */
  n: number;
  /** Taxa de alta nos casos de treino (régua "sempre sobe" do modelo). */
  alwaysUpP: number;
  /** Pesos nas features padronizadas, do maior para o menor em módulo (transparência). */
  coefficients: { name: FeatureName; weight: number }[];
}

export interface ModelHorizon {
  horizon: number;
  /** null = casos de treino de menos para ajustar (nada inventado). */
  current: ModelCurrent | null;
  /** Fora da amostra, walk-forward com purga e embargo; pontos sem sobreposição. */
  history: Scoreboard;
  points: ScoredPrediction[];
  /** Quantas vezes o modelo foi reajustado no histórico. */
  refits: number;
}

interface Dataset {
  X: number[][];
  y: boolean[];
  up: number;
}

/** Casos i com features e rótulo conhecido até `maxIndex` (i + horizon ≤ maxIndex + horizon). */
function dataset(
  feats: readonly (readonly number[] | null)[],
  closes: readonly number[],
  horizon: number,
  maxIndex: number,
): Dataset {
  const X: number[][] = [];
  const y: boolean[] = [];
  let up = 0;
  for (let i = 0; i <= maxIndex; i++) {
    const x = feats[i];
    const c1 = closes[i + horizon];
    if (!x || c1 === undefined) continue;
    const u = c1 > (closes[i] as number);
    X.push(x as number[]);
    y.push(u);
    if (u) up++;
  }
  return { X, y, up };
}

/**
 * Camada 2 (SPEC §23.2, ADR-0034): regressão logística em walk-forward. No ponto t o modelo só foi
 * ajustado com casos cujo rótulo (o fechamento i + horizonte) é conhecido ANTES de t, com folga de
 * `embargo` candles: i + horizonte + embargo ≤ t (purga + embargo). Reajuste a cada `refitEvery` candles.
 * Pontos avaliados sem sobreposição (um a cada `horizon` candles).
 */
export function walkForwardModel(
  feats: readonly (readonly number[] | null)[],
  closes: readonly number[],
  times: readonly number[],
  horizon: number,
  params: PredictParams = DEFAULT_PREDICT,
): ModelHorizon {
  const last = closes.length - 1;
  const scored: ScoredPrediction[] = [];
  let model: LogisticModel | null = null;
  let modelUp = 0.5;
  let fitAt = Number.NEGATIVE_INFINITY;
  let refits = 0;
  let next = params.warmup;
  for (let t = params.warmup; t + horizon <= last; t++) {
    if (t < next) continue;
    const x = feats[t];
    if (!x) continue;
    if (!model || t >= fitAt + params.refitEvery) {
      const cut = t - horizon - params.embargo;
      const d = cut >= 0 ? dataset(feats, closes, horizon, cut) : null;
      if (d && d.X.length >= params.minTrain) {
        // sempre do zero: partir do modelo anterior (outra padronização) fez o Newton não convergir
        model = fitLogistic(d.X, d.y, { l2: params.l2 });
        modelUp = d.up / d.X.length;
        fitAt = t;
        refits++;
      }
    }
    if (!model) continue;
    scored.push({
      time: times[t] as number,
      p: predictLogistic(model, x),
      alwaysUpP: modelUp,
      persistUp: t > 0 ? (closes[t] as number) > (closes[t - 1] as number) : null,
      up: (closes[t + horizon] as number) > (closes[t] as number),
    });
    next = t + horizon;
  }

  // modelo de agora: todos os rótulos já conhecidos (i + horizonte ≤ último candle)
  let current: ModelCurrent | null = null;
  const xNow = feats[last];
  const all = dataset(feats, closes, horizon, last - horizon);
  if (xNow && all.X.length >= params.minTrain) {
    const m = fitLogistic(all.X, all.y, { l2: params.l2 });
    current = {
      p: predictLogistic(m, xNow),
      n: all.X.length,
      alwaysUpP: all.up / all.X.length,
      coefficients: m.w
        .map((weight, j) => ({ name: FEATURE_NAMES[j] as FeatureName, weight }))
        .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    };
  }
  return {
    horizon,
    current,
    history: scorePredictions(scored, params.minCases),
    points: scored,
    refits,
  };
}
