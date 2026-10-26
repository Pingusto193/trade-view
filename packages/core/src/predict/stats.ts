/** Intervalo de uma proporção (0 a 1). */
export interface ProbInterval {
  lo: number;
  hi: number;
}

/**
 * Intervalo de confiança de Wilson para k sucessos em n tentativas (z = 1,96 → 95%). Melhor que o
 * "p ± 2 erros" com amostras pequenas ou taxas perto de 0/100%. null sem tentativas.
 */
export function wilson(k: number, n: number, z = 1.96): ProbInterval | null {
  if (!(n > 0)) return null;
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/** Brier: média de (probabilidade − resultado)²; 0 = perfeito, 0,25 = moeda. */
export function brier(ps: readonly number[], ys: readonly boolean[]): number | null {
  if (ps.length === 0) return null;
  let s = 0;
  for (let i = 0; i < ps.length; i++) {
    const d = (ps[i] as number) - (ys[i] ? 1 : 0);
    s += d * d;
  }
  return s / ps.length;
}

export interface CalibrationBin {
  /** Faixa de probabilidade prevista [from, to). */
  from: number;
  to: number;
  n: number;
  /** Média das probabilidades previstas na faixa. */
  meanP: number;
  /** Quantas vezes subiu de fato (0 a 1) e o intervalo de Wilson. */
  upRate: number;
  ci: ProbInterval | null;
}

/**
 * Curva de calibração: agrupa as previsões em faixas de probabilidade e compara com o que aconteceu.
 * Bem calibrado = "quando diz 60%, sobe ~60% das vezes". Só devolve faixas com casos.
 */
export function calibration(
  ps: readonly number[],
  ys: readonly boolean[],
  bins = 10,
): CalibrationBin[] {
  const acc = Array.from({ length: bins }, () => ({ n: 0, sumP: 0, up: 0 }));
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i] as number;
    const b = Math.min(bins - 1, Math.max(0, Math.floor(p * bins)));
    const a = acc[b]!;
    a.n++;
    a.sumP += p;
    if (ys[i]) a.up++;
  }
  return acc.flatMap((a, b) =>
    a.n === 0
      ? []
      : [
          {
            from: b / bins,
            to: (b + 1) / bins,
            n: a.n,
            meanP: a.sumP / a.n,
            upRate: a.up / a.n,
            ci: wilson(a.up, a.n),
          },
        ],
  );
}
