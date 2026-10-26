/**
 * Regressão logística com regularização L2 (SPEC §23.2, camada 2), em TypeScript puro. Ajuste por
 * Newton (IRLS): com ~20 features e alguns milhares de casos converge em poucas iterações. As features são
 * padronizadas com média e desvio do PRÓPRIO conjunto de treino (nada do teste vaza para o ajuste).
 */
export interface LogisticModel {
  /** Pesos nas features padronizadas e intercepto. */
  w: number[];
  b: number;
  mean: number[];
  sd: number[];
  /** Casos de treino e iterações usadas. */
  n: number;
  iters: number;
  converged: boolean;
}

export interface FitOptions {
  /** Força da regularização L2 (nas features padronizadas; o intercepto não é penalizado). */
  l2?: number;
  maxIter?: number;
  tol?: number;
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** Resolve A x = g (A simétrica positiva definida) por Cholesky. null se não for definida positiva. */
function cholSolve(A: number[][], g: number[]): number[] | null {
  const n = g.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (!(s > 0)) return null;
        L[i]![i] = Math.sqrt(s);
      } else L[i]![j] = s / L[j]![j]!;
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = g[i]!;
    for (let k = 0; k < i; k++) s -= L[i]![k]! * y[k]!;
    y[i] = s / L[i]![i]!;
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= L[k]![i]! * x[k]!;
    x[i] = s / L[i]![i]!;
  }
  return x;
}

export function fitLogistic(
  X: readonly (readonly number[])[],
  y: readonly boolean[],
  opts: FitOptions = {},
): LogisticModel {
  const n = X.length;
  if (n === 0) throw new Error('sem casos de treino');
  const d = X[0]!.length;
  const D = d + 1; // + intercepto
  const l2 = opts.l2 ?? 1;
  const mean = new Array<number>(d).fill(0);
  const sd = new Array<number>(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j]! += x[j]! / n;
  for (const x of X) for (let j = 0; j < d; j++) sd[j]! += (x[j]! - mean[j]!) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = sd[j]! > 1e-12 ? Math.sqrt(sd[j]!) : 1;
  // matriz padronizada contígua, com a coluna do intercepto (1) no fim de cada linha
  const Z = new Float64Array(n * D);
  const Y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = X[i]!;
    const o = i * D;
    for (let j = 0; j < d; j++) Z[o + j] = (x[j]! - mean[j]!) / sd[j]!;
    Z[o + d] = 1;
    Y[i] = y[i] ? 1 : 0;
  }
  // começa do zero: Newton sem busca de passo pode não convergir partindo de pesos de outra padronização
  const theta = new Float64Array(D);
  const maxIter = opts.maxIter ?? 50;
  const tol = opts.tol ?? 1e-8;
  const g = new Float64Array(D);
  const H = new Float64Array(D * D);
  let iters = 0;
  let converged = false;
  for (; iters < maxIter; iters++) {
    g.fill(0);
    H.fill(0);
    for (let i = 0; i < n; i++) {
      const o = i * D;
      let s = 0;
      for (let j = 0; j < D; j++) s += theta[j]! * Z[o + j]!;
      const p = sigmoid(s);
      const r = p - Y[i]!;
      const wgt = Math.max(p * (1 - p), 1e-10);
      for (let j = 0; j < D; j++) {
        const zj = Z[o + j]!;
        g[j]! += r * zj;
        const a = zj * wgt;
        const row = j * D;
        for (let k = 0; k <= j; k++) H[row + k]! += a * Z[o + k]!;
      }
    }
    for (let j = 0; j < d; j++) {
      g[j]! += l2 * theta[j]!;
      H[j * D + j]! += l2;
    }
    H[d * D + d]! += 1e-9;
    const A: number[][] = [];
    for (let j = 0; j < D; j++) {
      const row: number[] = [];
      for (let k = 0; k < D; k++) row.push(k <= j ? H[j * D + k]! : H[k * D + j]!);
      A.push(row);
    }
    const step = cholSolve(A, Array.from(g));
    if (!step) break;
    let max = 0;
    for (let j = 0; j < D; j++) {
      theta[j]! -= step[j]!;
      max = Math.max(max, Math.abs(step[j]!));
    }
    if (max < tol) {
      converged = true;
      iters++;
      break;
    }
  }
  return {
    w: Array.from(theta.subarray(0, d)),
    b: theta[d]!,
    mean,
    sd,
    n,
    iters,
    converged,
  };
}

/** Probabilidade de "sobe" para um vetor de features (na escala original). */
export function predictLogistic(m: LogisticModel, x: readonly number[]): number {
  let s = m.b;
  for (let j = 0; j < m.w.length; j++) s += m.w[j]! * ((x[j]! - m.mean[j]!) / m.sd[j]!);
  return sigmoid(s);
}
