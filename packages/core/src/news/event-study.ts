import type { Candle } from '@radar/shared';
import { wilson, type ProbInterval } from '../predict/stats';

/**
 * Estudo de evento (SPEC §23.1): o que o preço fez depois de cada tipo de notícia, com o tamanho da
 * amostra, e quanto do movimento já tinha acontecido ANTES de a notícia chegar ao Radar.
 *
 * Referência = fechamento do último candle que JÁ tinha fechado na hora da publicação (r). Movimento
 * depois = fechamento r + h ÷ fechamento r − 1. Chegada = último candle fechado antes de a notícia chegar
 * (a); "já tinha acontecido" = (fechamento a ÷ fechamento r − 1) ÷ movimento depois. Casos do MESMO grupo
 * não se sobrepõem (o próximo só depois de h candles). Régua: um candle qualquer no mesmo período.
 */
export interface StudyEvent {
  /** Publicação informada pela fonte (UTC ms). */
  publishedAt: number;
  /** Chegada ao Radar; null quando não se sabe (ex.: histórico da CVM, só com a data). */
  arrivedAt: number | null;
  /** Grupos em que o evento entra (tipo, tema, leitura da IA…). */
  groups: string[];
}

export interface GroupHorizon {
  horizon: number;
  /** Casos sem sobreposição. */
  n: number;
  /** % de vezes que o preço estava mais alto h candles depois (0 a 1) e Wilson. */
  upRate: number | null;
  upCi: ProbInterval | null;
  /** Mediana do movimento (com sinal) e média do movimento em módulo (tamanho). */
  medianMove: number | null;
  meanAbsMove: number | null;
  /** Tamanho comparado com um candle qualquer (1 = igual; 2 = o dobro). */
  vsBaseline: number | null;
  /** Mediana da fração do movimento que já tinha acontecido quando a notícia chegou (casos com hora). */
  shareBeforeArrival: number | null;
  /** Casos com a hora de chegada conhecida (os que entram na fração acima). */
  nArrival: number;
  /** Mediana do que sobrou para quem agiu na chegada (fechamento a + h ÷ fechamento a − 1). */
  medianAfterArrival: number | null;
}

export interface GroupStudy {
  group: string;
  horizons: GroupHorizon[];
  /** Movimento nos 5 candles ANTES da publicação (antecipação/vazamento): mediana com sinal. */
  medianDriftBefore: number | null;
}

export interface EventStudy {
  groups: GroupStudy[];
  /** Régua: um candle qualquer no período (média do movimento em módulo e % de alta, por horizonte). */
  baseline: { horizon: number; n: number; meanAbsMove: number | null; upRate: number | null }[];
  events: number;
  /** Eventos fora do período dos candles (não entram). */
  outside: number;
  from: number | null;
  to: number | null;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Último índice com candle FECHADO até o instante t (abertura + duração ≤ t); -1 se nenhum. */
function lastClosedAt(candles: readonly Candle[], t: number, tfMs: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((candles[mid] as Candle).time + tfMs <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function eventStudy(
  candles: readonly Candle[],
  events: readonly StudyEvent[],
  opts: { tfMs: number; horizons?: readonly number[]; driftBars?: number },
): EventStudy {
  const horizons = opts.horizons ?? [1, 5, 20];
  const drift = opts.driftBars ?? 5;
  const last = candles.length - 1;
  const close = (i: number) => (candles[i] as Candle).close;
  type Case = { r: number; a: number | null };
  const byGroup = new Map<string, Case[]>();
  let outside = 0;
  const sorted = [...events].sort((x, y) => x.publishedAt - y.publishedAt);
  for (const e of sorted) {
    const r = lastClosedAt(candles, e.publishedAt, opts.tfMs);
    if (r < 0 || r >= last) {
      outside++;
      continue;
    }
    const a =
      e.arrivedAt === null ? null : Math.max(r, lastClosedAt(candles, e.arrivedAt, opts.tfMs));
    for (const g of e.groups) byGroup.set(g, [...(byGroup.get(g) ?? []), { r, a }]);
  }

  const groups: GroupStudy[] = [];
  for (const [group, cases] of byGroup) {
    const hs: GroupHorizon[] = horizons.map((h) => {
      // sem sobreposição dentro do grupo
      const used: Case[] = [];
      let next = -1;
      for (const c of cases) {
        if (c.r < next || c.r + h > last || !(close(c.r) > 0)) continue;
        used.push(c);
        next = c.r + h;
      }
      const moves = used.map((c) => close(c.r + h) / close(c.r) - 1);
      const ups = moves.filter((m) => m > 0).length;
      const withArr = used.filter((c) => c.a !== null && (c.a as number) + h <= last);
      const shares = withArr
        .map((c) => {
          const total = close(c.r + h) / close(c.r) - 1;
          const pre = close(c.a as number) / close(c.r) - 1;
          return Math.abs(total) > 1e-9 ? pre / total : null;
        })
        .filter((x): x is number => x !== null)
        .map((x) => Math.max(-1, Math.min(2, x)));
      const afterArr = withArr.map((c) => close((c.a as number) + h) / close(c.a as number) - 1);
      return {
        horizon: h,
        n: moves.length,
        upRate: moves.length ? ups / moves.length : null,
        upCi: wilson(ups, moves.length),
        medianMove: median(moves),
        meanAbsMove: mean(moves.map(Math.abs)),
        vsBaseline: null,
        shareBeforeArrival: median(shares),
        nArrival: withArr.length,
        medianAfterArrival: median(afterArr),
      };
    });
    const drifts = cases
      .filter((c) => c.r - drift >= 0)
      .map((c) => close(c.r) / close(c.r - drift) - 1);
    groups.push({ group, horizons: hs, medianDriftBefore: median(drifts) });
  }

  const baseline = horizons.map((h) => {
    const moves: number[] = [];
    for (let i = 0; i + h <= last; i += h)
      if (close(i) > 0) moves.push(close(i + h) / close(i) - 1);
    return {
      horizon: h,
      n: moves.length,
      meanAbsMove: mean(moves.map(Math.abs)),
      upRate: moves.length ? moves.filter((m) => m > 0).length / moves.length : null,
    };
  });
  for (const g of groups)
    for (const x of g.horizons) {
      const b = baseline.find((y) => y.horizon === x.horizon)?.meanAbsMove ?? null;
      x.vsBaseline = b && x.meanAbsMove !== null ? x.meanAbsMove / b : null;
    }
  groups.sort((a, b) => (b.horizons[0]?.n ?? 0) - (a.horizons[0]?.n ?? 0));
  return {
    groups,
    baseline,
    events: events.length,
    outside,
    from: candles[0]?.time ?? null,
    to: candles[last]?.time ?? null,
  };
}
