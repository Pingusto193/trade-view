import {
  FundamentalsTimeline,
  computeFundamentals,
  type FundamentalFact,
  type Fundamentals,
} from '@radar/core';
import {
  CVM_SOURCE,
  DataSourceError,
  SEC_SOURCE,
  b3BaseTicker,
  cik10,
  cvmFactsFor,
  normalizeUsTicker,
  type CvmClient,
  type CvmDreLine,
  type CvmShareClass,
  type SecEdgarClient,
} from '@radar/data';
import { formatDateTime, type SymbolMeta } from '@radar/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import { fundamentalFacts, fundamentalTickers, seriesFetch } from '../db/schema';

const DAY = 86_400_000;

/**
 * Validade do cache (decisão nossa, ADR-0024): fundamentos mudam por trimestre e as fontes publicam
 * no máximo uma vez por semana (CVM). Arquivos de anos antigos da CVM quase não mudam.
 */
export const FUNDAMENTALS_TTL = {
  secTickers: 7 * DAY,
  secFacts: 7 * DAY,
  cvmFca: 7 * DAY,
  cvmRecentYear: 7 * DAY,
  cvmOldYear: 30 * DAY,
} as const;
/** Depois de um erro, espera isto antes de tentar a fonte de novo (não martela quem está fora). */
export const FUNDAMENTALS_RETRY_MS = 30 * 60_000;
/** Anos de DFP para os fundamentos de hoje: 3 exercícios + o ano que ainda está sendo entregue. */
const CVM_YEARS_NOW = 4;
/** O histórico de DFP nos dados abertos começa em 2010 (DATA_SOURCES §6.2). */
const CVM_FIRST_YEAR = 2010;
const TF = 'fundamentos';

interface Loaded {
  source: string;
  facts: FundamentalFact[];
  /** Avisos (fonte fora do ar com a data do último dado válido, ticker sem cadastro…). */
  notes: string[];
}

interface Ensured {
  error: string | null;
  lastOkAt: number | null;
}

/** Erro "não existe" (empresa sem XBRL, ano da DFP ainda não publicado): não é falha da fonte. */
const isNotFound = (err: unknown) => err instanceof DataSourceError && err.status === 404;

/**
 * Fundamentos para a Reflexividade (SPEC §8.8): SEC EDGAR para ações dos EUA e CVM (DFP) para a B3,
 * com cache no SQLite. A lógica do cálculo é a do `@radar/core`. Fonte fora do ar = o último dado
 * guardado com o erro e a data; sem nada guardado = "não verificado" com o motivo (nunca inventa).
 */
export class FundamentalsService {
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly sec: SecEdgarClient,
    private readonly cvm: CvmClient,
    private readonly now: () => number = Date.now,
    private readonly log?: FastifyBaseLogger,
  ) {}

  /** O ativo tem fonte de fundamentos? (Ações dos EUA e da B3; nunca dados simulados.) */
  static supports(meta: SymbolMeta): boolean {
    return meta.delay.kind !== 'simulated' && (meta.market === 'us' || meta.market === 'b3');
  }

  /** Fundamentos conhecidos hoje. null = mercado sem fonte (cripto, forex, simulado). */
  async forSymbol(meta: SymbolMeta): Promise<Fundamentals | null> {
    if (!FundamentalsService.supports(meta)) return null;
    const year = new Date(this.now()).getUTCFullYear();
    const r =
      meta.market === 'us'
        ? await this.loadSec(meta.symbol)
        : await this.loadCvm(meta.symbol, year - CVM_YEARS_NOW + 1, year);
    const fu = computeFundamentals(r.facts, { source: r.source, asOf: this.now() });
    const notes = [...r.notes, ...(fu.notes ?? [])];
    return { ...fu, ...(notes.length ? { notes } : {}) };
  }

  /**
   * Linha do tempo SEM look-ahead para o laboratório (só balanços com data de publicação conhecida e
   * anterior a cada candle). null = sem fonte ou sem nenhum dado; as notas dizem por quê.
   */
  async timeline(
    meta: SymbolMeta,
    from: number,
  ): Promise<{ timeline: FundamentalsTimeline | null; notes: string[] }> {
    if (!FundamentalsService.supports(meta))
      return { timeline: null, notes: ['Sem fonte de fundamentos para este mercado.'] };
    const year = new Date(this.now()).getUTCFullYear();
    // 3 exercícios antes do começo do teste, para o primeiro candle já ter o crescimento de 2 anos
    const first = Math.max(CVM_FIRST_YEAR, new Date(from).getUTCFullYear() - 3);
    const r =
      meta.market === 'us'
        ? await this.loadSec(meta.symbol)
        : await this.loadCvm(meta.symbol, first, year);
    const tl = new FundamentalsTimeline(r.facts, r.source);
    if (tl.firstFiled === null) return { timeline: null, notes: r.notes };
    return { timeline: tl, notes: r.notes };
  }

  // ---------------------------------------------------------------- controle de busca

  private state(key: string) {
    const row = this.db
      .select()
      .from(seriesFetch)
      .where(and(eq(seriesFetch.symbolId, key), eq(seriesFetch.tf, TF)))
      .get();
    return {
      at: row?.fetchedAt ?? 0,
      error: row?.lastError ?? null,
      errorAt: row?.lastErrorAt ?? null,
    };
  }

  private mark(key: string, error: string | null): void {
    const t = this.now();
    const prev = this.state(key);
    const row = error
      ? { symbolId: key, tf: TF, fetchedAt: prev.at, lastError: error, lastErrorAt: t }
      : { symbolId: key, tf: TF, fetchedAt: t, lastError: null, lastErrorAt: null };
    this.db
      .insert(seriesFetch)
      .values(row)
      .onConflictDoUpdate({ target: [seriesFetch.symbolId, seriesFetch.tf], set: row })
      .run();
  }

  /** Busca na fonte se o cache venceu (uma busca por chave de cada vez; espera após erro). */
  private async ensure(key: string, ttlMs: number, run: () => Promise<void>): Promise<Ensured> {
    const st = this.state(key);
    const t = this.now();
    const fresh = st.at > 0 && t - st.at < ttlMs;
    const cooling = st.errorAt !== null && t - st.errorAt < FUNDAMENTALS_RETRY_MS;
    if (!fresh && !cooling) {
      let p = this.inflight.get(key);
      if (!p) {
        p = run()
          .then(
            () => this.mark(key, null),
            (err: unknown) => {
              if (isNotFound(err)) return this.mark(key, null);
              this.log?.warn({ err, key }, 'fundamentos: falha na fonte');
              this.mark(key, (err as Error).message);
            },
          )
          .finally(() => this.inflight.delete(key));
        this.inflight.set(key, p);
      }
      await p;
    }
    const s = this.state(key);
    return { error: s.error, lastOkAt: s.at || null };
  }

  private sourceNote(label: string, e: Ensured, hasData: boolean): string[] {
    if (!e.error) return [];
    return [
      hasData && e.lastOkAt
        ? `${label} indisponível agora (${e.error}); usando os dados guardados em ${formatDateTime(e.lastOkAt)} (último dado válido).`
        : `${label} indisponível: ${e.error}. Sem dado guardado: fundamentos não verificados.`,
    ];
  }

  private ticker(source: 'sec' | 'cvm', ticker: string) {
    return this.db
      .select()
      .from(fundamentalTickers)
      .where(and(eq(fundamentalTickers.source, source), eq(fundamentalTickers.ticker, ticker)))
      .get();
  }

  private saveTickers(
    source: 'sec' | 'cvm',
    rows: { ticker: string; entity: string; name: string | null; shareClass: string | null }[],
  ): void {
    const sqlite = this.db.$client;
    const del = sqlite.prepare('DELETE FROM fundamental_tickers WHERE source = ?');
    const ins = sqlite.prepare(
      'INSERT OR REPLACE INTO fundamental_tickers (source, ticker, entity, name, share_class) VALUES (?, ?, ?, ?, ?)',
    );
    sqlite.transaction(() => {
      del.run(source);
      for (const r of rows) ins.run(source, r.ticker, r.entity, r.name, r.shareClass);
    })();
  }

  private saveFacts(
    source: 'sec' | 'cvm',
    rows: readonly (FundamentalFact & { entity: string })[],
  ): void {
    if (!rows.length) return;
    const sqlite = this.db.$client;
    const ins = sqlite.prepare(
      `INSERT INTO fundamental_facts (source, entity, metric, concept, rank, start, "end", value, doc, filed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source, entity, concept, start, "end", doc) DO UPDATE SET
         value = excluded.value, filed = excluded.filed, rank = excluded.rank`,
    );
    sqlite.transaction(() => {
      for (const f of rows)
        ins.run(
          source,
          f.entity,
          f.metric,
          f.concept,
          f.rank,
          f.start,
          f.end,
          f.value,
          f.doc,
          f.filed,
        );
    })();
  }

  private facts(source: 'sec' | 'cvm', entity: string): FundamentalFact[] {
    return this.db
      .select()
      .from(fundamentalFacts)
      .where(and(eq(fundamentalFacts.source, source), eq(fundamentalFacts.entity, entity)))
      .all()
      .map((r) => ({
        metric: r.metric === 'eps' ? 'eps' : 'revenue',
        concept: r.concept,
        rank: r.rank,
        start: r.start,
        end: r.end,
        value: r.value,
        doc: r.doc,
        filed: r.filed,
      }));
  }

  // ---------------------------------------------------------------- SEC EDGAR

  private async loadSec(symbol: string): Promise<Loaded> {
    const source = SEC_SOURCE;
    if (!this.sec.isConfigured())
      return {
        source,
        facts: [],
        notes: [
          'SEC EDGAR não configurada: preencha SEC_USER_AGENT no .env com um nome e um e-mail de contato (exigência da SEC).',
        ],
      };
    const t = normalizeUsTicker(symbol);
    const tk = await this.ensure('fund:sec:tickers', FUNDAMENTALS_TTL.secTickers, async () => {
      const map = await this.sec.tickers();
      this.saveTickers(
        'sec',
        [...map.values()].map((c) => ({
          ticker: c.ticker,
          entity: String(c.cik),
          name: c.name,
          shareClass: null,
        })),
      );
    });
    const row = this.ticker('sec', t);
    if (!row)
      return {
        source,
        facts: [],
        notes: tk.error
          ? this.sourceNote(source, tk, false)
          : [`${t} não está no cadastro de tickers da SEC (ETF, fundo ou empresa estrangeira?).`],
      };
    const cik = Number(row.entity);
    const fx = await this.ensure(`fund:sec:${cik10(cik)}`, FUNDAMENTALS_TTL.secFacts, async () => {
      const r = await this.sec.companyFacts(cik);
      this.saveFacts(
        'sec',
        r.facts.map((f) => ({ ...f, entity: row.entity })),
      );
    });
    const facts = this.facts('sec', row.entity);
    return { source, facts, notes: this.sourceNote(source, fx, facts.length > 0) };
  }

  // ---------------------------------------------------------------- CVM

  private async loadCvm(symbol: string, fromYear: number, toYear: number): Promise<Loaded> {
    const source = CVM_SOURCE;
    const t = b3BaseTicker(symbol);
    const fca = await this.ensure('fund:cvm:fca', FUNDAMENTALS_TTL.cvmFca, async () => {
      const y = new Date(this.now()).getUTCFullYear();
      // o FCA do ano novo pode ainda não existir em janeiro
      const map = await this.cvm.fca(y).catch((err: unknown) => {
        if (isNotFound(err)) return this.cvm.fca(y - 1);
        throw err;
      });
      this.saveTickers(
        'cvm',
        [...map.values()].map((x) => ({
          ticker: x.ticker,
          entity: x.cnpj,
          name: null,
          shareClass: x.shareClass,
        })),
      );
    });
    const row = this.ticker('cvm', t);
    if (!row)
      return {
        source,
        facts: [],
        notes: fca.error
          ? this.sourceNote(`${source}: cadastro (FCA)`, fca, false)
          : [`${t} não está no cadastro da CVM (FCA): ETF, FII, BDR ou companhia sem registro?`],
      };
    const cur = new Date(this.now()).getUTCFullYear();
    const errors: Ensured[] = [];
    for (let y = Math.max(CVM_FIRST_YEAR, fromYear); y <= toYear; y++) {
      const ttl = y >= cur - 1 ? FUNDAMENTALS_TTL.cvmRecentYear : FUNDAMENTALS_TTL.cvmOldYear;
      const e = await this.ensure(`fund:cvm:dfp:${y}`, ttl, async () => {
        const d = await this.cvm.dfp(y);
        this.saveFacts('cvm', d.lines.map(lineToFact));
      });
      if (e.error) errors.push(e);
    }
    const lines = this.facts('cvm', row.entity).map(factToLine(row.entity));
    const c = cvmFactsFor(lines, (row.shareClass as CvmShareClass | null) ?? null);
    const notes = [...c.notes];
    if (errors.length) notes.push(...this.sourceNote(source, errors[0]!, lines.length > 0));
    return { source, facts: c.facts, notes };
  }
}

/** Linha da DRE → fato guardado (o rótulo da conta vai no `concept`). */
function lineToFact(l: CvmDreLine): FundamentalFact & { entity: string } {
  return {
    entity: l.cnpj,
    metric: l.code === '3.01' ? 'revenue' : 'eps',
    concept: `${l.statement}|${l.code}|${l.label}`,
    rank: l.statement === 'con' ? 0 : 1,
    start: l.start,
    end: l.end,
    value: l.value,
    doc: l.doc,
    filed: l.filed,
  };
}

const factToLine =
  (cnpj: string) =>
  (f: FundamentalFact): CvmDreLine => {
    const [statement, code, ...label] = f.concept.split('|');
    return {
      cnpj,
      statement: statement === 'ind' ? 'ind' : 'con',
      code: code ?? '',
      label: label.join('|'),
      start: f.start,
      end: f.end,
      value: f.value,
      doc: f.doc,
      filed: f.filed,
    };
  };
