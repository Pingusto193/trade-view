import type { FundamentalFact } from '@radar/core';
import { HttpClient, type FetchFn } from '../http';
import { DataSourceError, NotConfiguredError } from '../types';

/**
 * SEC EDGAR — fatos XBRL das empresas dos EUA (docs/DATA_SOURCES.md §6.1, ADR-0024).
 * - `company_tickers.json`: ticker → CIK (a SEC não garante exatidão nem abrangência) 🟡
 * - `api/xbrl/companyfacts/CIK##########.json`: todos os fatos da empresa 🟡 🔌
 * - Limite oficial: 10 requisições/s; usamos no máximo 5/s. User-Agent com contato é obrigatório.
 * O adaptador só traduz o formato; o cálculo está em `@radar/core` (`computeFundamentals`).
 */
export const SEC_SOURCE = 'SEC EDGAR';

/** Tags de LPA em ordem de preferência (us-gaap, unidade USD/shares). */
export const SEC_EPS_TAGS = ['EarningsPerShareBasic', 'EarningsPerShareBasicAndDiluted'] as const;
/** Tags de receita em ordem de preferência (us-gaap, unidade USD). */
export const SEC_REVENUE_TAGS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
] as const;
/** Relatórios anuais (10-K, 10-K/A, 10-KT, 20-F, 40-F). Os trimestrais (10-Q) ficam de fora. */
const ANNUAL_FORMS = /^(10-K|20-F|40-F)/;

interface SecFactRaw {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  frame?: string;
}

export interface SecCompanyFactsJson {
  cik: number;
  entityName?: string;
  facts?: Record<string, Record<string, { label?: string; units?: Record<string, SecFactRaw[]> }>>;
}

export interface SecCompany {
  cik: number;
  ticker: string;
  name: string;
}

export interface SecFacts {
  cik: number;
  name: string;
  facts: FundamentalFact[];
  /** Avisos de leitura (ex.: LPA só em outra moeda). */
  notes: string[];
}

/** "AAAA-MM-DD" → meia-noite UTC; null se inválida. */
function isoDay(s: string | undefined): number | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

/** Normaliza o ticker (classe com ponto ou hífen: BRK.B = BRK-B). */
export const normalizeUsTicker = (t: string) => t.trim().toUpperCase().replace(/[./]/g, '-');

export const cik10 = (cik: number) => `CIK${String(cik).padStart(10, '0')}`;

/** Lê o `company_tickers.json` (objeto com chaves "0", "1", … e `{cik_str, ticker, title}`). */
export function parseCompanyTickers(json: unknown): Map<string, SecCompany> {
  const out = new Map<string, SecCompany>();
  if (!json || typeof json !== 'object') return out;
  for (const v of Object.values(json as Record<string, unknown>)) {
    const r = v as { cik_str?: unknown; ticker?: unknown; title?: unknown };
    const cik = Number(r.cik_str);
    if (!Number.isInteger(cik) || cik <= 0 || typeof r.ticker !== 'string') continue;
    const ticker = normalizeUsTicker(r.ticker);
    if (!out.has(ticker))
      out.set(ticker, { cik, ticker, name: typeof r.title === 'string' ? r.title : ticker });
  }
  return out;
}

/**
 * Converte o companyfacts em fatos para o core: só `us-gaap`, só relatórios anuais e só fatos de
 * período (com `start`). LPA em USD/shares; receita em USD. Outras unidades são ignoradas com aviso.
 */
export function parseCompanyFacts(json: SecCompanyFactsJson): SecFacts {
  const gaap = json.facts?.['us-gaap'] ?? {};
  const facts: FundamentalFact[] = [];
  const notes: string[] = [];
  const read = (
    metric: FundamentalFact['metric'],
    tags: readonly string[],
    unit: string,
    what: string,
  ) => {
    tags.forEach((tag, rank) => {
      const units = gaap[tag]?.units;
      if (!units) return;
      const list = units[unit];
      if (!list) {
        const other = Object.keys(units);
        if (other.length) notes.push(`${what} (${tag}) só em ${other.join(', ')}: não usado.`);
        return;
      }
      for (const r of list) {
        if (!ANNUAL_FORMS.test(r.form ?? '')) continue;
        const start = isoDay(r.start);
        const end = isoDay(r.end);
        if (start === null || end === null || end <= start || !Number.isFinite(r.val)) continue;
        facts.push({
          metric,
          concept: tag,
          rank,
          start,
          end,
          value: r.val,
          doc: r.accn,
          filed: isoDay(r.filed),
        });
      }
    });
  };
  read('eps', SEC_EPS_TAGS, 'USD/shares', 'LPA');
  read('revenue', SEC_REVENUE_TAGS, 'USD', 'Receita');
  return { cik: json.cik, name: json.entityName ?? cik10(json.cik), facts, notes };
}

export interface SecEdgarOptions {
  /** Identificação com contato exigida pela SEC (ex.: "Radar pessoal voce@exemplo.com"). */
  userAgent?: string;
  fetch?: FetchFn;
  /** Base do data.sec.gov e do www.sec.gov (testes). */
  dataBase?: string;
  wwwBase?: string;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class SecEdgarClient {
  private readonly http: HttpClient;
  private readonly dataBase: string;
  private readonly wwwBase: string;
  readonly userAgent: string | null;

  constructor(opts: SecEdgarOptions = {}) {
    this.userAgent = opts.userAgent?.trim() || null;
    this.dataBase = opts.dataBase ?? 'https://data.sec.gov';
    this.wwwBase = opts.wwwBase ?? 'https://www.sec.gov';
    this.http = new HttpClient({
      source: SEC_SOURCE,
      // limite oficial de 10/s; usamos metade (decisão nossa)
      maxRequests: 5,
      perMs: 1000,
      timeoutMs: 30_000,
      ...(this.userAgent ? { headers: { 'User-Agent': this.userAgent } } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
  }

  isConfigured(): boolean {
    return this.userAgent !== null;
  }

  private guard(): void {
    if (!this.userAgent)
      throw new NotConfiguredError(
        SEC_SOURCE,
        'preencha SEC_USER_AGENT no .env com um nome e um e-mail de contato (exigência da SEC)',
      );
  }

  /** Mapa ticker → CIK oficial da SEC. */
  async tickers(): Promise<Map<string, SecCompany>> {
    this.guard();
    const json = await this.http.getJson<unknown>(`${this.wwwBase}/files/company_tickers.json`);
    const map = parseCompanyTickers(json);
    if (!map.size) throw new DataSourceError('company_tickers.json veio vazio', SEC_SOURCE);
    return map;
  }

  /** Fatos XBRL da empresa. Empresa sem XBRL na SEC = HTTP 404 (DataSourceError com status 404). */
  async companyFacts(cik: number): Promise<SecFacts> {
    this.guard();
    const json = await this.http.getJson<SecCompanyFactsJson>(
      `${this.dataBase}/api/xbrl/companyfacts/${cik10(cik)}.json`,
    );
    if (!json || typeof json !== 'object' || !Number.isFinite(Number(json.cik)))
      throw new DataSourceError('resposta inesperada do companyfacts', SEC_SOURCE);
    return parseCompanyFacts({ ...json, cik: Number(json.cik) });
  }
}
