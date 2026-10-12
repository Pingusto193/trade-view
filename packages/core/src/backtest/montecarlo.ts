/**
 * Monte Carlo por reamostragem da sequência de trades (SPEC §12.3): a mesma estratégia, outra ordem de
 * resultados (com reposição). Mostra quão ruim a queda do patrimônio pode ficar só por azar de
 * sequência, com o risco por trade escolhido.
 */
export interface MonteCarloResult {
  runs: number;
  /** Pior queda (fração do topo): percentis 5, 50 e 95. */
  drawdown: { p5: number; p50: number; p95: number };
  /** Retorno final: percentis 5, 50 e 95. */
  finalReturn: { p5: number; p50: number; p95: number };
  /** Probabilidade de, em algum momento, perder ao menos X do capital inicial. */
  probLoss: { at: number; p: number }[];
}

/** PRNG determinístico (mulberry32): o mesmo resultado a cada execução, para registrar e comparar. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pct(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

/**
 * @param rs resultados em R de cada trade (líquidos de custos)
 * @param riskPct risco por trade em % do patrimônio (1 = 1%)
 */
export function monteCarlo(
  rs: readonly number[],
  riskPct: number,
  opts: { runs?: number; seed?: number; lossLevels?: number[] } = {},
): MonteCarloResult {
  const runs = opts.runs ?? 10_000;
  const levels = opts.lossLevels ?? [0.1, 0.2, 0.3, 0.5];
  const rand = rng(opts.seed ?? 42);
  const dds: number[] = [];
  const finals: number[] = [];
  const hits = levels.map(() => 0);
  const f = riskPct / 100;
  for (let k = 0; k < runs && rs.length; k++) {
    let eq = 1;
    let peak = 1;
    let maxDd = 0;
    let minEq = 1;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[Math.floor(rand() * rs.length)]!;
      eq *= Math.max(0, 1 + r * f);
      peak = Math.max(peak, eq);
      maxDd = Math.max(maxDd, peak > 0 ? (peak - eq) / peak : 1);
      minEq = Math.min(minEq, eq);
    }
    dds.push(maxDd);
    finals.push(eq - 1);
    levels.forEach((lv, j) => {
      if (1 - minEq >= lv) hits[j]!++;
    });
  }
  dds.sort((a, b) => a - b);
  finals.sort((a, b) => a - b);
  const n = Math.max(1, dds.length);
  return {
    runs: dds.length,
    drawdown: { p5: pct(dds, 0.05), p50: pct(dds, 0.5), p95: pct(dds, 0.95) },
    finalReturn: { p5: pct(finals, 0.05), p50: pct(finals, 0.5), p95: pct(finals, 0.95) },
    probLoss: levels.map((at, j) => ({ at, p: hits[j]! / n })),
  };
}
