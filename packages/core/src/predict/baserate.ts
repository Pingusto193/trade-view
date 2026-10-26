import { wilson, type ProbInterval } from './stats';
import {
  SITUATION_FACETS,
  SITUATION_LEVELS,
  situationKey,
  type FacetId,
  type LevelId,
  type Situation,
} from './situation';

/** Contagem de uma situação: casos conferidos, quantos subiram e o próximo índice sem sobreposição. */
interface Cell {
  n: number;
  up: number;
  next: number;
}

export interface LevelStat {
  id: LevelId | FacetId;
  /** Casos conferidos (sem sobreposição). */
  n: number;
  up: number;
  /** % que subiu (0 a 1) e o intervalo de Wilson; null sem casos. */
  rate: number | null;
  ci: ProbInterval | null;
  /** Taxa encolhida para o nível mais geral (só nos níveis da estimativa). */
  shrunk?: number;
}

/** Probabilidade de o fechamento daqui a `horizon` candles ser MAIS ALTO que o de agora. */
export interface Estimate {
  horizon: number;
  /** A probabilidade da camada 1 (taxa da situação completa, encolhida em cadeia até 50%). */
  p: number;
  /** Do mais específico ao mais geral. */
  levels: LevelStat[];
  facets: LevelStat[];
  /** Régua "sempre sobe": taxa histórica de alta neste ativo e horizonte (0,5 sem casos). */
  alwaysUpP: number;
  /** Régua "persistência": o último candle subiu? (null sem candle anterior). */
  persistUp: boolean | null;
}

/**
 * Taxas-base condicionais (SPEC §23.2, camada 1), incremental e sem look-ahead: o caso do candle i só
 * entra na contagem quando o candle i + horizon fecha. Casos da MESMA situação não se sobrepõem (depois
 * de contar i, o próximo só a partir de i + horizon), senão a mesma subida contaria várias vezes e o
 * intervalo de confiança ficaria estreito demais.
 */
export class BaseRateModel {
  private readonly cells = new Map<string, Cell>();
  /** Fechamentos e situações ainda sem resultado (no máximo horizon + 1). */
  private readonly pending: { close: number; s: Situation }[] = [];
  private prevClose: number | null = null;
  private lastClose: number | null = null;
  private count = 0;

  constructor(
    readonly horizon: number,
    private readonly shrink = 30,
  ) {
    if (!(horizon >= 1)) throw new RangeError('horizonte deve ser ≥ 1');
  }

  /** Candles recebidos. */
  get length(): number {
    return this.count;
  }

  /** Recebe o fechamento e a situação de um candle FECHADO. */
  push(close: number, s: Situation): void {
    const i = this.count;
    this.count++;
    this.prevClose = this.lastClose;
    this.lastClose = close;
    this.pending.push({ close, s });
    if (this.pending.length > this.horizon) {
      const old = this.pending.shift()!;
      this.resolve(i - this.horizon, old.s, close > old.close);
    }
  }

  private resolve(i: number, s: Situation, up: boolean): void {
    for (const id of [...SITUATION_LEVELS, ...SITUATION_FACETS]) {
      const key = `${id}:${situationKey(s, id)}`;
      let c = this.cells.get(key);
      if (!c) {
        c = { n: 0, up: 0, next: 0 };
        this.cells.set(key, c);
      }
      if (i < c.next) continue;
      c.n++;
      if (up) c.up++;
      c.next = i + this.horizon;
    }
  }

  private stat(id: LevelId | FacetId, s: Situation): LevelStat {
    const c = this.cells.get(`${id}:${situationKey(s, id)}`);
    const n = c?.n ?? 0;
    const up = c?.up ?? 0;
    return { id, n, up, rate: n ? up / n : null, ci: wilson(up, n) };
  }

  /** Estimativa para a situação `s` (padrão: a do último candle), só com casos já conferidos. */
  estimate(s?: Situation): Estimate {
    const sit = s ?? this.pending.at(-1)?.s;
    if (!sit) throw new Error('sem candles');
    const levels = SITUATION_LEVELS.map((id) => this.stat(id, sit));
    // encolhimento em cadeia, do geral para o específico: (sobe + m·p_pai) ÷ (n + m)
    let parent = 0.5;
    for (let k = levels.length - 1; k >= 0; k--) {
      const l = levels[k]!;
      const m = this.shrink;
      parent = l.n + m > 0 ? (l.up + m * parent) / (l.n + m) : parent;
      l.shrunk = parent;
    }
    const any = levels.at(-1)!;
    return {
      horizon: this.horizon,
      p: levels[0]!.shrunk as number,
      levels,
      facets: SITUATION_FACETS.map((id) => this.stat(id, sit)),
      alwaysUpP: any.rate ?? 0.5,
      persistUp:
        this.prevClose === null || this.lastClose === null ? null : this.lastClose > this.prevClose,
    };
  }
}
