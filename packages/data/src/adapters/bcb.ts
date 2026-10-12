import { HttpClient, type FetchFn } from '../http';
import { DataSourceError } from '../types';

/**
 * Banco Central — SGS (séries temporais). Ver docs/DATA_SOURCES.md §7.
 * - 432: Meta Selic (% a.a.) ✅
 * - 12: CDI diário (% ao dia) 🟡
 * - 1178: Selic anualizada base 252 ✅
 * Desde 26/03/2025 cada consulta de série diária é limitada a 10 anos: buscamos em janelas.
 */
export const SGS = {
  SELIC_META: 432,
  CDI_DIARIO: 12,
  SELIC_ANUALIZADA: 1178,
} as const;

export interface SgsPoint {
  /** Meia-noite UTC da data. */
  date: number;
  value: number;
}

interface SgsRaw {
  data: string;
  valor: string;
}

function fmt(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

export function parseSgs(rows: readonly SgsRaw[]): SgsPoint[] {
  const out: SgsPoint[] = [];
  for (const r of rows) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r.data);
    const v = Number(r.valor);
    if (!m || !Number.isFinite(v)) continue;
    out.push({ date: Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])), value: v });
  }
  return out;
}

const NINE_YEARS_MS = 9 * 365 * 86_400_000;

export class BcbClient {
  private readonly http: HttpClient;
  private readonly base: string;

  constructor(opts: { fetch?: FetchFn; base?: string } = {}) {
    this.base = opts.base ?? 'https://api.bcb.gov.br/dados/serie';
    this.http = new HttpClient({
      source: 'Banco Central (SGS)',
      maxRequests: 5,
      perMs: 1000,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  /** Série entre duas datas (meia-noite UTC), em janelas de até 9 anos. */
  async getSeries(code: number, from: number, to: number): Promise<SgsPoint[]> {
    if (to < from) return [];
    const out: SgsPoint[] = [];
    for (let start = from; start <= to; start += NINE_YEARS_MS + 86_400_000) {
      const end = Math.min(to, start + NINE_YEARS_MS);
      const url = `${this.base}/bcdata.sgs.${code}/dados?formato=json&dataInicial=${fmt(start)}&dataFinal=${fmt(end)}`;
      const rows = await this.http.getJson<SgsRaw[] | { erro?: unknown }>(url);
      if (!Array.isArray(rows)) throw new DataSourceError('resposta inesperada do SGS', 'BCB');
      out.push(...parseSgs(rows));
    }
    return out;
  }

  /** Últimos N valores (para o painel: Selic e CDI atuais). */
  async getLast(code: number, n = 1): Promise<SgsPoint[]> {
    const rows = await this.http.getJson<SgsRaw[]>(
      `${this.base}/bcdata.sgs.${code}/dados/ultimos/${n}?formato=json`,
    );
    return parseSgs(rows);
  }
}

/**
 * Acumula o CDI diário (% ao dia) num fator: ∏(1 + taxa/100).
 * Ex.: retorno do CDI entre duas datas = fator − 1.
 */
export function accumulateCdi(points: readonly SgsPoint[], from: number, to: number): number {
  let f = 1;
  for (const p of points) if (p.date >= from && p.date <= to) f *= 1 + p.value / 100;
  return f;
}

/** Converte taxa diária (% a.d.) em anual base 252 (% a.a.). */
export function dailyToAnnual252(dailyPct: number): number {
  return ((1 + dailyPct / 100) ** 252 - 1) * 100;
}
