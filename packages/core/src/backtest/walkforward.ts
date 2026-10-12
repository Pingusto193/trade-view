import type { BtTrade } from './engine';

/**
 * Walk-forward (SPEC §12.3): em cada janela, escolhe o valor do parâmetro que foi MELHOR no passado
 * (treino ancorado no início) e mede esse valor só no trecho seguinte, que ele nunca viu. Soma os
 * trechos "nunca vistos" para responder: escolher o melhor parâmetro olhando para trás funciona para
 * a frente?
 *
 * Usa os trades de um backtest completo por valor (o mesmo motor); os trechos são recortes pela data
 * de entrada. Aproximação documentada: a posição aberta de um trecho pode bloquear o primeiro sinal do
 * seguinte, como aconteceria de verdade com uma posição por vez.
 */
export interface WalkForwardFold {
  trainFrom: number;
  trainTo: number;
  testFrom: number;
  testTo: number;
  /** Valor escolhido no treino (null: nenhum valor teve trades suficientes no treino). */
  chosen: number | null;
  trainExpectancyR: number | null;
  testTrades: number;
  testExpectancyR: number | null;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  /** Todos os trechos fora da amostra juntos. */
  oosTrades: number;
  oosExpectancyR: number | null;
}

const mean = (xs: readonly number[]) =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

export function walkForward(
  byValue: readonly { value: number; trades: readonly BtTrade[] }[],
  from: number,
  to: number,
  opts: { initial?: number; folds?: number; minTrainTrades?: number } = {},
): WalkForwardResult {
  const initial = opts.initial ?? 0.5;
  const k = opts.folds ?? 5;
  const minTrain = opts.minTrainTrades ?? 10;
  const span = to - from;
  const edge = (i: number) => from + span * (initial + ((1 - initial) * i) / k);
  const folds: WalkForwardFold[] = [];
  const oos: number[] = [];
  for (let i = 0; i < k; i++) {
    const trainTo = edge(i);
    const testFrom = trainTo;
    // o último trecho inclui o último candle
    const testTo = i === k - 1 ? to + 1 : edge(i + 1);
    let best: { value: number; exp: number } | null = null;
    for (const v of byValue) {
      // só trades que JÁ terminaram antes do fim do treino (sem espiar o resultado futuro)
      const rs = v.trades.filter((t) => t.exitTime < trainTo).map((t) => t.r);
      const exp = mean(rs);
      if (rs.length < minTrain || exp === null) continue;
      if (!best || exp > best.exp) best = { value: v.value, exp };
    }
    const test = best
      ? (byValue.find((v) => v.value === best.value)?.trades ?? []).filter(
          (t) => t.entryTime >= testFrom && t.entryTime < testTo,
        )
      : [];
    oos.push(...test.map((t) => t.r));
    folds.push({
      trainFrom: from,
      trainTo,
      testFrom,
      testTo: Math.min(testTo, to),
      chosen: best?.value ?? null,
      trainExpectancyR: best?.exp ?? null,
      testTrades: test.length,
      testExpectancyR: mean(test.map((t) => t.r)),
    });
  }
  return { folds, oosTrades: oos.length, oosExpectancyR: mean(oos) };
}
