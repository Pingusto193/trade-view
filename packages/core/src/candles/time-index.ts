/**
 * Converte tempo real (UTC ms) ↔ posição lógica de barra (pode ser fracionária ou fora da série).
 * Os desenhos guardam tempo real, então a mesma linha aparece certa em qualquer escala.
 * Fora da série (passado distante ou futuro), extrapola com o espaçamento mediano entre candles.
 */
export class TimeIndex {
  private readonly step: number;

  constructor(private readonly times: readonly number[]) {
    const diffs: number[] = [];
    for (let i = Math.max(1, times.length - 200); i < times.length; i++) {
      diffs.push((times[i] as number) - (times[i - 1] as number));
    }
    diffs.sort((a, b) => a - b);
    this.step = diffs.length ? (diffs[Math.floor(diffs.length / 2)] as number) : 60_000;
  }

  get length(): number {
    return this.times.length;
  }

  /** Posição lógica (índice fracionário) de um instante. */
  toLogical(t: number): number {
    const ts = this.times;
    const n = ts.length;
    if (n === 0) return 0;
    const first = ts[0] as number;
    const last = ts[n - 1] as number;
    if (t <= first) return (t - first) / this.step;
    if (t >= last) return n - 1 + (t - last) / this.step;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((ts[mid] as number) <= t) lo = mid;
      else hi = mid;
    }
    const a = ts[lo] as number;
    const b = ts[hi] as number;
    return lo + (t - a) / (b - a);
  }

  /** Instante de uma posição lógica (arredondada para o candle mais próximo se `snap`). */
  toTime(logical: number, snap = true): number {
    const ts = this.times;
    const n = ts.length;
    if (n === 0) return 0;
    const l = snap ? Math.round(logical) : logical;
    if (l <= 0) return (ts[0] as number) + l * this.step;
    if (l >= n - 1) return (ts[n - 1] as number) + (l - (n - 1)) * this.step;
    const i = Math.floor(l);
    const a = ts[i] as number;
    const b = ts[i + 1] as number;
    return a + (l - i) * (b - a);
  }
}
