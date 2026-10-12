/**
 * Base dos indicadores incrementais.
 *
 * Todo indicador do Radar é um "stream" com estado:
 * - `next(x)` consome um valor **fechado** e avança o estado;
 * - `peek(x)` calcula o valor para um candle **em formação**, sem alterar o estado;
 * - `clone()` copia o estado (usado pelo `peek` e pelo replay).
 *
 * As funções em lote (ex.: `ema(values, 9)`) são apenas um laço sobre o stream, então o cálculo
 * em lote e o incremental são a **mesma implementação** (SPEC §3.4).
 *
 * Convenção de aquecimento: enquanto não há dados suficientes, a saída é `NaN`.
 * Entrada `NaN` produz saída `NaN` e **não altera o estado** — isso permite encadear indicadores
 * (ex.: ADX = média de Wilder do DX, que começa com NaN).
 */
export abstract class Stream<I, O> {
  abstract next(input: I): O;
  abstract clone(): Stream<I, O>;

  peek(input: I): O {
    return this.clone().next(input);
  }
}

/** Buffer circular de tamanho fixo. */
export class Ring {
  private readonly buf: Float64Array;
  private start = 0;
  private len = 0;

  constructor(readonly capacity: number) {
    this.buf = new Float64Array(capacity);
  }

  push(x: number): void {
    if (this.len < this.capacity) {
      this.buf[(this.start + this.len) % this.capacity] = x;
      this.len++;
    } else {
      this.buf[this.start] = x;
      this.start = (this.start + 1) % this.capacity;
    }
  }

  get size(): number {
    return this.len;
  }

  get full(): boolean {
    return this.len === this.capacity;
  }

  /** i = 0 é o mais antigo. */
  at(i: number): number {
    return this.buf[(this.start + i) % this.capacity] as number;
  }

  sum(): number {
    let s = 0;
    for (let i = 0; i < this.len; i++) s += this.at(i);
    return s;
  }

  max(): number {
    let m = -Infinity;
    for (let i = 0; i < this.len; i++) m = Math.max(m, this.at(i));
    return m;
  }

  min(): number {
    let m = Infinity;
    for (let i = 0; i < this.len; i++) m = Math.min(m, this.at(i));
    return m;
  }

  copy(): Ring {
    const r = new Ring(this.capacity);
    for (let i = 0; i < this.len; i++) r.push(this.at(i));
    return r;
  }
}

export function assertPeriod(period: number, name: string): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`${name}: período deve ser inteiro ≥ 1 (recebido ${period})`);
  }
}

/** Executa um stream sobre uma série inteira (modo lote). */
export function runStream<I, O>(stream: Stream<I, O>, inputs: readonly I[]): O[] {
  const out = new Array<O>(inputs.length);
  for (let i = 0; i < inputs.length; i++) out[i] = stream.next(inputs[i] as I);
  return out;
}
