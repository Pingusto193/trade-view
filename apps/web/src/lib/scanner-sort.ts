import type { ScanRow, TrendValue } from '@radar/shared';

/** Colunas ordenáveis da tabela do scanner. */
export type ScanSortKey =
  | 'symbol'
  | 'close'
  | 'setups'
  | 'trend'
  | 'adx'
  | 'ddTf'
  | 'dd52'
  | 'relVolume'
  | 'source';

export type SortDir = 'asc' | 'desc';

const STATE_RANK = { radar: 1, armado: 2, acionado: 3 } as const;
const TREND_RANK: Record<TrendValue, number | null> = {
  alta: 3,
  lateral: 2,
  baixa: 1,
  indefinida: null,
};

/** Valor de cada linha numa coluna (null = sem dado: vai sempre para o fim). */
export function sortValue(r: ScanRow, key: ScanSortKey): number | string | null {
  const a = r.analysis;
  switch (key) {
    case 'symbol':
      return r.symbol;
    case 'source':
      return r.source?.label ?? null;
    case 'close':
      return a?.lastClose ?? null;
    case 'setups':
      // o estado mais avançado manda; empate: quantos setups ativos
      return a
        ? Math.max(0, ...a.setups.map((s) => STATE_RANK[s.state])) * 100 + a.setups.length
        : null;
    case 'trend':
      return a ? TREND_RANK[a.trend] : null;
    case 'adx':
      return a?.adx ?? null;
    case 'ddTf':
      return a?.drawdown.tf ?? null;
    case 'dd52':
      return a?.drawdown.w52 ?? null;
    case 'relVolume':
      return a?.relVolume ?? null;
  }
}

/** Ordena (estável) por uma coluna; linhas sem dado ficam no fim nas duas direções. */
export function sortRows(rows: readonly ScanRow[], key: ScanSortKey, dir: SortDir): ScanRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: sortValue(r, key) }))
    .sort((x, y) => {
      if (x.v === null || y.v === null) return x.v === y.v ? x.i - y.i : x.v === null ? 1 : -1;
      const c =
        typeof x.v === 'string' || typeof y.v === 'string'
          ? String(x.v).localeCompare(String(y.v), 'pt-BR')
          : x.v - y.v;
      return c === 0 ? x.i - y.i : sign * c;
    })
    .map((x) => x.r);
}
