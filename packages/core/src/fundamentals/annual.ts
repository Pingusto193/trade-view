import { formatSessionDate } from '@radar/shared';
import type { Fundamentals } from '../setups/types';

/**
 * Fundamentos da Reflexividade (SPEC §8.8, ADR-0024): crescimento do LPA em 2 anos e receita sem
 * queda, só com exercícios ANUAIS. Lógica única: os adaptadores (SEC EDGAR, CVM) só traduzem o
 * formato da fonte em `FundamentalFact`; o cálculo é este, no servidor, no scanner e no laboratório.
 *
 * Nunca inventa: dado ausente, prejuízo no ponto de partida, histórico curto ou troca de ano fiscal
 * deixam o campo nulo ("não verificado") com a explicação nas notas.
 */

const DAY = 86_400_000;

export type FundamentalMetric = 'eps' | 'revenue';

/** Um valor anual ou trimestral publicado num documento da fonte. */
export interface FundamentalFact {
  metric: FundamentalMetric;
  /** Conta de origem (tag XBRL ou conta da CVM). Séries de contas diferentes nunca se misturam. */
  concept: string;
  /** Preferência entre contas da mesma métrica (menor = preferida). */
  rank: number;
  /** Início e fim do período (meia-noite UTC das datas). */
  start: number;
  end: number;
  value: number;
  /** Documento de origem (SEC: número de acesso; CVM: CNPJ + data de referência + versão). */
  doc: string;
  /** Meia-noite UTC do dia em que o documento ficou público; null = desconhecido. */
  filed: number | null;
}

/** Duração de um exercício anual em dias (52/53 semanas ou ano civil). Decisão nossa. */
export const ANNUAL_DAYS = { min: 340, max: 380 } as const;
/** Distância, em dias, entre o fim de dois exercícios anuais seguidos. Decisão nossa. */
export const FY_STEP_DAYS = { min: 350, max: 380 } as const;
/** Último exercício que terminou há mais que isto (dias) = desatualizado. Decisão nossa (~18 meses). */
export const FUNDAMENTALS_MAX_AGE_DAYS = 550;

export interface FundamentalsOptions {
  /** Nome da fonte para as notas (ex.: "SEC EDGAR"). */
  source: string;
  /** Momento da consulta: só entram documentos públicos até aqui. */
  asOf: number;
  /**
   * true = só documentos publicados ANTES do dia de `asOf` (laboratório: o balanço publicado num dia
   * só vale a partir do candle seguinte) e nunca os de data desconhecida.
   */
  strict?: boolean;
  maxAgeDays?: number;
}

export const isAnnualPeriod = (f: Pick<FundamentalFact, 'start' | 'end'>): boolean => {
  const d = (f.end - f.start) / DAY;
  return d >= ANNUAL_DAYS.min && d <= ANNUAL_DAYS.max;
};

interface Obs {
  value: number;
  doc: string;
  filed: number | null;
  /** Ordem de chegada (desempate: o que veio depois vence). */
  order: number;
}

interface Series {
  concept: string;
  rank: number;
  byEnd: Map<number, Obs[]>;
  /** Fins de exercício em ordem crescente. */
  ends: number[];
}

interface MetricResult<T> {
  value: T | null;
  negative?: boolean;
  periodEnd: number | null;
  filedAt: number | null;
  note: string | null;
}

/** Resultado antes do teste de idade (o laboratório reaproveita entre candles). */
interface Analysis {
  eps: MetricResult<number>;
  revenue: MetricResult<boolean>;
}

const year = (t: number) => new Date(t).getUTCFullYear();
const filedKey = (o: Obs) => o.filed ?? Number.NEGATIVE_INFINITY;
const later = (a: Obs, b: Obs) =>
  filedKey(a) !== filedKey(b) ? filedKey(a) > filedKey(b) : a.order > b.order;
const maxOf = (...xs: (number | null)[]): number | null => {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length ? Math.max(...ok) : null;
};

function seriesOf(facts: readonly FundamentalFact[], metric: FundamentalMetric): Series[] {
  const map = new Map<string, Series>();
  facts.forEach((f, order) => {
    if (f.metric !== metric || !Number.isFinite(f.value)) return;
    let s = map.get(f.concept);
    if (!s) {
      s = { concept: f.concept, rank: f.rank, byEnd: new Map(), ends: [] };
      map.set(f.concept, s);
    }
    s.rank = Math.min(s.rank, f.rank);
    const list = s.byEnd.get(f.end);
    const o: Obs = { value: f.value, doc: f.doc, filed: f.filed, order };
    if (list) list.push(o);
    else s.byEnd.set(f.end, [o]);
  });
  for (const s of map.values()) s.ends = [...s.byEnd.keys()].sort((a, b) => a - b);
  return [...map.values()];
}

/** Contas com o exercício mais recente, na ordem de preferência. */
function candidates(list: readonly Series[]): Series[] {
  const last = Math.max(...list.map((s) => s.ends.at(-1) ?? Number.NEGATIVE_INFINITY));
  return list.filter((s) => s.ends.at(-1) === last).sort((a, b) => a.rank - b.rank);
}

function latest(list: readonly Obs[]): Obs {
  return list.reduce((best, o) => (later(o, best) ? o : best));
}

/** Fim do exercício anterior (350 a 380 dias antes); null se não houver (histórico curto ou troca de ano fiscal). */
function prevEnd(s: Series, end: number): number | null {
  let found: number | null = null;
  for (const e of s.ends) {
    const d = (end - e) / DAY;
    if (d >= FY_STEP_DAYS.min && d <= FY_STEP_DAYS.max) found = e;
  }
  return found;
}

/**
 * LPA de dois exercícios, de preferência do MESMO documento (mesma base por ação: um desdobramento
 * ajusta os comparativos do documento novo, mas não o documento antigo). Sem documento comum, usa o
 * valor publicado por último de cada um.
 */
function pair(
  s: Series,
  prev: number,
  cur: number,
): { a: number; b: number; sameDoc: boolean; filed: number | null } {
  const A = s.byEnd.get(prev)!;
  const B = s.byEnd.get(cur)!;
  let best: { oa: Obs; ob: Obs } | null = null;
  for (const ob of B) {
    const oa = A.find((x) => x.doc === ob.doc);
    if (oa && (!best || later(ob, best.ob))) best = { oa, ob };
  }
  if (best) return { a: best.oa.value, b: best.ob.value, sameDoc: true, filed: best.ob.filed };
  const la = latest(A);
  const lb = latest(B);
  return { a: la.value, b: lb.value, sameDoc: false, filed: maxOf(la.filed, lb.filed) };
}

const SHORT = 'menos de 3 exercícios anuais seguidos (histórico curto ou troca de ano fiscal)';
const MIXED = 'valores de documentos diferentes (um desdobramento não ajustado pode distorcer)';

function epsOf(s: Series): MetricResult<number> {
  const y = s.ends.at(-1)!;
  const yObs = latest(s.byEnd.get(y)!);
  if (yObs.value <= 0)
    return {
      value: null,
      negative: true,
      periodEnd: y,
      filedAt: yObs.filed,
      note: `LPA de ${year(y)} negativo ou zero (prejuízo): o critério de crescimento falha`,
    };
  const y1 = prevEnd(s, y);
  const y2 = y1 === null ? null : prevEnd(s, y1);
  if (y1 === null || y2 === null)
    return { value: null, periodEnd: y, filedAt: yObs.filed, note: SHORT };
  const pB = pair(s, y1, y);
  const pA = pair(s, y2, y1);
  let ratio: number;
  let sameDoc: boolean;
  let filed: number | null;
  if (pB.a !== 0 && pA.a !== 0) {
    // encadeado ano a ano: cada razão sai de um documento só
    ratio = (pB.b / pB.a) * (pA.b / pA.a);
    sameDoc = pA.sameDoc && pB.sameDoc;
    filed = maxOf(pA.filed, pB.filed, yObs.filed);
  } else {
    const d = pair(s, y2, y);
    ratio = d.a !== 0 ? d.b / d.a : Number.NaN;
    sameDoc = d.sameDoc;
    filed = maxOf(d.filed, yObs.filed);
  }
  if (!(ratio > 0) || !Number.isFinite(ratio))
    return {
      value: null,
      periodEnd: y,
      filedAt: filed,
      note: `LPA de ${year(y2)} negativo ou zero: o crescimento composto não se aplica`,
    };
  return {
    // 9 casas: 20% exatos não podem reprovar por erro de arredondamento binário (1,44 → 0,1999…)
    value: Math.round((Math.sqrt(ratio) - 1) * 1e9) / 1e9,
    periodEnd: y,
    filedAt: filed,
    note: sameDoc ? null : MIXED,
  };
}

/**
 * Receita é total (não "por ação"): desdobramento não a afeta, mas reapresentações sim. Vale o valor
 * publicado por último de cada exercício.
 */
function revenueOf(s: Series): MetricResult<boolean> {
  const at = (end: number) => latest(s.byEnd.get(end)!);
  const y = s.ends.at(-1)!;
  const vY = at(y);
  const y1 = prevEnd(s, y);
  if (y1 === null) return { value: null, periodEnd: y, filedAt: vY.filed, note: SHORT };
  const vY1 = at(y1);
  if (vY.value < vY1.value)
    return {
      value: false,
      periodEnd: y,
      filedAt: maxOf(vY.filed, vY1.filed),
      note: `receita caiu em ${year(y)}`,
    };
  const y2 = prevEnd(s, y1);
  if (y2 === null)
    return { value: null, periodEnd: y, filedAt: maxOf(vY.filed, vY1.filed), note: SHORT };
  const vY2 = at(y2);
  const filedAt = maxOf(vY.filed, vY1.filed, vY2.filed);
  if (vY1.value < vY2.value)
    return { value: false, periodEnd: y, filedAt, note: `receita caiu em ${year(y1)}` };
  return { value: true, periodEnd: y, filedAt, note: null };
}

/** Tenta as contas do exercício mais recente, na ordem de preferência; fica com a primeira que responde. */
function bestOf<T>(
  list: readonly Series[],
  fn: (s: Series) => MetricResult<T>,
  missing: string,
): MetricResult<T> {
  if (!list.length) return { value: null, periodEnd: null, filedAt: null, note: missing };
  let first: MetricResult<T> | null = null;
  for (const s of candidates(list)) {
    const r = fn(s);
    if (r.value !== null || r.negative) return r;
    first ??= r;
  }
  return first!;
}

function visible(f: FundamentalFact, asOf: number, strict: boolean): boolean {
  if (!isAnnualPeriod(f)) return false; // trimestres e acumulados de 6/9 meses ficam de fora
  if (f.filed === null) return !strict;
  return strict ? f.filed < asOf : f.filed <= asOf;
}

function analyze(facts: readonly FundamentalFact[]): Analysis {
  return {
    eps: bestOf(seriesOf(facts, 'eps'), epsOf, 'a fonte não tem LPA anual deste ativo'),
    revenue: bestOf(
      seriesOf(facts, 'revenue'),
      revenueOf,
      'a fonte não tem receita anual deste ativo',
    ),
  };
}

function aged<T>(r: MetricResult<T>, asOf: number, maxAgeDays: number): MetricResult<T> {
  if (r.periodEnd === null || (asOf - r.periodEnd) / DAY <= maxAgeDays) return r;
  return {
    value: null,
    periodEnd: r.periodEnd,
    filedAt: r.filedAt,
    note: `último exercício anual terminou em ${formatSessionDate(r.periodEnd)}: dado desatualizado`,
  };
}

function finish(a: Analysis, source: string, asOf: number, maxAgeDays: number): Fundamentals {
  const eps = aged(a.eps, asOf, maxAgeDays);
  const rev = aged(a.revenue, asOf, maxAgeDays);
  const notes = [
    ...(eps.note ? [`LPA: ${eps.note}.`] : []),
    ...(rev.note ? [`Receita: ${rev.note}.`] : []),
  ];
  const periodEnd = maxOf(eps.periodEnd, rev.periodEnd);
  const filedAt = maxOf(eps.filedAt, rev.filedAt);
  return {
    epsGrowth2y: eps.value,
    revenueNoDecline: rev.value,
    ...(eps.negative ? { epsNegative: true } : {}),
    source,
    ...(periodEnd !== null ? { periodEnd } : {}),
    ...(filedAt !== null ? { filedAt } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

/**
 * Fundamentos conhecidos em `asOf`: crescimento anual composto do LPA em 2 exercícios
 * (√(LPA_ano ÷ LPA_ano−2) − 1, encadeando as razões ano a ano dentro de cada documento) e receita
 * anual sem queda nos 2 últimos exercícios (ano ≥ ano−1 ≥ ano−2).
 */
export function computeFundamentals(
  facts: readonly FundamentalFact[],
  opts: FundamentalsOptions,
): Fundamentals {
  const strict = Boolean(opts.strict);
  const seen = facts.filter((f) => visible(f, opts.asOf, strict));
  return finish(
    analyze(seen),
    opts.source,
    opts.asOf,
    opts.maxAgeDays ?? FUNDAMENTALS_MAX_AGE_DAYS,
  );
}

/**
 * Fundamentos candle a candle SEM look-ahead (laboratório): em cada candle, só documentos com data de
 * publicação conhecida e ANTERIOR ao dia do candle. O cálculo é refeito só quando sai documento novo.
 */
export class FundamentalsTimeline {
  private readonly facts: FundamentalFact[];
  /** Datas de publicação, em ordem. */
  private readonly stamps: number[];
  private readonly memo = new Map<number, Analysis>();
  /** Fatos com data de publicação desconhecida (ficam de fora do laboratório). */
  readonly undated: number;

  constructor(
    facts: readonly FundamentalFact[],
    private readonly source: string,
    private readonly maxAgeDays = FUNDAMENTALS_MAX_AGE_DAYS,
  ) {
    const annual = facts.filter(isAnnualPeriod);
    this.facts = annual.filter((f) => f.filed !== null);
    this.undated = annual.length - this.facts.length;
    this.stamps = [...new Set(this.facts.map((f) => f.filed!))].sort((a, b) => a - b);
  }

  /** Primeira data de publicação conhecida (null = nenhuma). */
  get firstFiled(): number | null {
    return this.stamps[0] ?? null;
  }

  at(time: number): Fundamentals {
    // último documento publicado antes do dia do candle (busca binária)
    let lo = 0;
    let hi = this.stamps.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.stamps[mid]! < time) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (idx < 0)
      return {
        epsGrowth2y: null,
        revenueNoDecline: null,
        source: this.source,
        notes: ['Nenhum balanço publicado antes desta data.'],
      };
    const cut = this.stamps[idx]!;
    let a = this.memo.get(cut);
    if (!a) {
      a = analyze(this.facts.filter((f) => f.filed! <= cut));
      this.memo.set(cut, a);
    }
    return finish(a, this.source, time, this.maxAgeDays);
  }
}
