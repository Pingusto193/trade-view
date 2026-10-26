import { DEFAULT_PREDICT } from './params';
import { brier, calibration, wilson, type CalibrationBin, type ProbInterval } from './stats';

/** Uma previsão já conferida: o que se disse antes e o que aconteceu depois. */
export interface ScoredPrediction {
  time: number;
  /** Probabilidade de fechar mais alto (0 a 1). */
  p: number;
  /** As réguas no mesmo momento (só com o passado). */
  alwaysUpP: number;
  persistUp: boolean | null;
  /** Fechou mais alto? */
  up: boolean;
}

export type BaselineId = 'moeda' | 'sempre-sobe' | 'persistencia';

export const BASELINE_LABEL: Readonly<Record<BaselineId, string>> = {
  moeda: 'Moeda (50%)',
  'sempre-sobe': 'Sempre sobe',
  persistencia: 'Persistência (repete o último candle)',
};

export interface MethodScore {
  n: number;
  /** Acertos (empate em 50% vale meio acerto, como uma moeda). */
  hits: number;
  accuracy: number | null;
  ci: ProbInterval | null;
  brier: number | null;
}

/** "SEM VANTAGEM COMPROVADA" é o padrão; vantagem só com amostra e com o pior caso acima das réguas. */
export type Verdict = 'vantagem' | 'sem-vantagem' | 'poucos-casos';

export interface Scoreboard {
  n: number;
  /** Quantas vezes subiu de fato no período (0 a 1). */
  upRate: number | null;
  model: MethodScore;
  baselines: Record<BaselineId, MethodScore>;
  /** A régua mais difícil de vencer em acerto. */
  best: BaselineId;
  calibration: CalibrationBin[];
  verdict: Verdict;
  from: number | null;
  to: number | null;
}

function method(probs: number[], ys: boolean[]): MethodScore {
  const n = ys.length;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const p = probs[i] as number;
    hits += p > 0.5 ? (ys[i] ? 1 : 0) : p < 0.5 ? (ys[i] ? 0 : 1) : 0.5;
  }
  return {
    n,
    hits,
    accuracy: n ? hits / n : null,
    ci: wilson(hits, n),
    brier: brier(probs, ys),
  };
}

/**
 * Placar de uma lista de previsões conferidas, contra as três réguas da SPEC §23.2. Veredito
 * (ADR-0033): "vantagem" só se houver pelo menos `minCases` previsões, o LIMITE INFERIOR do intervalo de
 * Wilson do acerto ficar acima do acerto da melhor régua E o Brier for menor que o de todas.
 */
export function scorePredictions(
  list: readonly ScoredPrediction[],
  minCases = DEFAULT_PREDICT.minCases,
): Scoreboard {
  const ys = list.map((x) => x.up);
  const model = method(
    list.map((x) => x.p),
    ys,
  );
  const baselines: Record<BaselineId, MethodScore> = {
    moeda: method(
      list.map(() => 0.5),
      ys,
    ),
    'sempre-sobe': {
      ...method(
        list.map(() => 1),
        ys,
      ),
      // Brier da régua com a probabilidade que ela teria dito (taxa histórica de alta)
      brier: brier(
        list.map((x) => x.alwaysUpP),
        ys,
      ),
    },
    persistencia: method(
      list.map((x) => (x.persistUp === null ? 0.5 : x.persistUp ? 1 : 0)),
      ys,
    ),
  };
  const ids = Object.keys(baselines) as BaselineId[];
  const best = ids.reduce((a, b) =>
    (baselines[b].accuracy ?? 0) > (baselines[a].accuracy ?? 0) ? b : a,
  );
  let verdict: Verdict = 'sem-vantagem';
  if (list.length < minCases) verdict = 'poucos-casos';
  else {
    const bestAcc = baselines[best].accuracy ?? 0.5;
    const bestBrier = Math.min(...ids.map((id) => baselines[id].brier ?? 0.25));
    if ((model.ci?.lo ?? 0) > bestAcc && (model.brier ?? 1) < bestBrier) verdict = 'vantagem';
  }
  return {
    n: list.length,
    upRate: list.length ? ys.filter(Boolean).length / list.length : null,
    model,
    baselines,
    best,
    calibration: calibration(
      list.map((x) => x.p),
      ys,
    ),
    verdict,
    from: list[0]?.time ?? null,
    to: list.at(-1)?.time ?? null,
  };
}
