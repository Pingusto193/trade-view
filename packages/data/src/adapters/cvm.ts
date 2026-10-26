import type { FundamentalFact } from '@radar/core';
import { unzipSync } from 'fflate';
import { HttpClient, type FetchFn } from '../http';
import { DataSourceError } from '../types';

/**
 * CVM — Dados Abertos das companhias abertas (docs/DATA_SOURCES.md §6.2 e §6.3, ADR-0024).
 * - DFP anual: `DOC/DFP/DADOS/dfp_cia_aberta_AAAA.zip` com o índice (`DT_RECEB`) e a DRE consolidada
 *   e individual (CSV `;`, ISO-8859-1) 🟡 🔌
 * - FCA: `DOC/FCA/DADOS/fca_cia_aberta_AAAA.zip` → `valor_mobiliario` com o ticker
 *   (`Codigo_Negociacao`) e o CNPJ: é o mapa oficial ticker → empresa 🟡 🔌
 * Contas usadas: 3.01 (receita) e 3.99.01.* (lucro básico por ação, por classe). O ITR (trimestral)
 * não é usado. O cálculo está em `@radar/core` (`computeFundamentals`).
 */
export const CVM_SOURCE = 'CVM (DFP)';
export const CVM_BASE = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC';

export const dfpZipName = (year: number) => `dfp_cia_aberta_${year}.zip`;
export const fcaZipName = (year: number) => `fca_cia_aberta_${year}.zip`;
export const ipeZipName = (year: number) => `ipe_cia_aberta_${year}.zip`;

/** Classe da ação no ticker. UNIT = units (ON + PN juntas): a CVM não publica LPA por unit. */
export type CvmShareClass = 'ON' | 'PN' | 'PNA' | 'PNB' | 'PNC' | 'PND' | 'PNU' | 'UNIT';

export interface CvmTicker {
  ticker: string;
  /** CNPJ só com dígitos (14). */
  cnpj: string;
  shareClass: CvmShareClass | null;
}

/** Linha da DRE que interessa: receita (3.01) ou LPA básico (3.99.01.*). */
export interface CvmDreLine {
  cnpj: string;
  statement: 'con' | 'ind';
  code: string;
  label: string;
  start: number;
  end: number;
  /** Receita em reais (já multiplicada pela escala); LPA em reais por ação. */
  value: number;
  /** CNPJ + data de referência + versão do documento. */
  doc: string;
  /** Data de recebimento pela CVM (meia-noite UTC); null se o índice não trouxer. */
  filed: number | null;
}

export interface CvmDfp {
  year: number;
  lines: CvmDreLine[];
  /** CNPJ → nome da companhia (DENOM_CIA). */
  companies: Map<string, string>;
}

// ------------------------------------------------------------------ leitura dos arquivos

/** CSV separado por `;`, com aspas opcionais (aspas duplicadas = aspas literais). */
export function parseCsv(text: string, sep = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/** Linhas como objetos pelo cabeçalho (nomes de coluna sem espaços). */
function records(text: string): Record<string, string>[] {
  const [head, ...body] = parseCsv(text);
  if (!head) return [];
  const cols = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}

const latin1 = new TextDecoder('latin1');
const digits = (s: string) => s.replace(/\D/g, '');

function isoDay(s: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function num(s: string): number {
  const t = s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s;
  return t === '' ? Number.NaN : Number(t);
}

/** Tira acentos e põe em maiúsculas (comparação de rótulos). */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

function unzip(bytes: Uint8Array, want: (name: string) => boolean): Map<string, string> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => want(f.name) });
  } catch (err) {
    throw new DataSourceError(`zip da CVM ilegível: ${(err as Error).message}`, CVM_SOURCE);
  }
  const out = new Map<string, string>();
  for (const [name, data] of Object.entries(files)) out.set(name, latin1.decode(data));
  return out;
}

/**
 * Lê o zip anual da DFP: índice (data de recebimento de cada versão) e DRE consolidada/individual.
 * Só ficam a receita (3.01) e o LPA básico por classe (3.99.01.*), em reais (MOEDA = REAL).
 */
export function parseDfpZip(bytes: Uint8Array, year: number): CvmDfp {
  const files = unzip(bytes, (n) =>
    new RegExp(`dfp_cia_aberta_(DRE_(con|ind)_)?${year}\\.csv$`).test(n),
  );
  const pick = (re: RegExp) => [...files.entries()].find(([n]) => re.test(n))?.[1];
  const head = pick(new RegExp(`dfp_cia_aberta_${year}\\.csv$`));
  const con = pick(new RegExp(`DRE_con_${year}\\.csv$`));
  const ind = pick(new RegExp(`DRE_ind_${year}\\.csv$`));
  if (!con && !ind)
    throw new DataSourceError(`a DFP de ${year} não trouxe a DRE (arquivo mudou?)`, CVM_SOURCE);

  const docKey = (r: Record<string, string>) =>
    `${digits(r.CNPJ_CIA ?? '')}|${r.DT_REFER ?? ''}|v${r.VERSAO ?? ''}`;
  const filedBy = new Map<string, number | null>();
  const companies = new Map<string, string>();
  for (const r of head ? records(head) : []) {
    filedBy.set(docKey(r), isoDay(r.DT_RECEB));
    if (r.DENOM_CIA) companies.set(digits(r.CNPJ_CIA ?? ''), r.DENOM_CIA);
  }

  const lines: CvmDreLine[] = [];
  for (const [statement, text] of [
    ['con', con],
    ['ind', ind],
  ] as const) {
    if (!text) continue;
    for (const r of records(text)) {
      const code = r.CD_CONTA ?? '';
      const isRevenue = code === '3.01';
      if (!isRevenue && !code.startsWith('3.99.01.')) continue;
      if (norm(r.MOEDA ?? 'REAL') !== 'REAL') continue;
      const start = isoDay(r.DT_INI_EXERC);
      const end = isoDay(r.DT_FIM_EXERC);
      let value = num(r.VL_CONTA ?? '');
      if (start === null || end === null || !Number.isFinite(value)) continue;
      // a escala vale para os valores em reais; o LPA já vem em reais por ação
      if (isRevenue && norm(r.ESCALA_MOEDA ?? '') === 'MIL') value *= 1000;
      const cnpj = digits(r.CNPJ_CIA ?? '');
      if (r.DENOM_CIA && !companies.has(cnpj)) companies.set(cnpj, r.DENOM_CIA);
      const doc = docKey(r);
      lines.push({
        cnpj,
        statement,
        code,
        label: r.DS_CONTA ?? '',
        start,
        end,
        value,
        doc,
        filed: filedBy.get(doc) ?? null,
      });
    }
  }
  return { year, lines, companies };
}

function classOf(valorMobiliario: string, classePn: string, ticker: string): CvmShareClass | null {
  const v = norm(valorMobiliario);
  if (v.startsWith('ACOES ORDINARIAS')) return 'ON';
  if (v.startsWith('ACOES PREFERENCIAIS')) {
    const m = /CLASSE\s+([A-Z])/.exec(norm(classePn));
    if (!m) return 'PN';
    const c = `PN${m[1]}`;
    return (['PNA', 'PNB', 'PNC', 'PND', 'PNU'] as const).find((x) => x === c) ?? null;
  }
  if (v.startsWith('UNITS')) return 'UNIT';
  if (v) return null; // debêntures, BDRs etc.
  // sem o tipo no arquivo: pelo final do ticker (glossário da B3)
  const suf = /(\d+)$/.exec(ticker)?.[1];
  const bySuffix: Record<string, CvmShareClass> = {
    '3': 'ON',
    '4': 'PN',
    '5': 'PNA',
    '6': 'PNB',
    '7': 'PNC',
    '8': 'PND',
    '11': 'UNIT',
  };
  return (suf && bySuffix[suf]) || null;
}

/**
 * Lê o zip do FCA: ticker → CNPJ e classe. Se o mesmo ticker aparecer mais de uma vez, vale o que
 * ainda negocia (sem data de fim) e, entre eles, o do documento mais novo.
 */
export function parseFcaZip(bytes: Uint8Array, year: number): Map<string, CvmTicker> {
  const files = unzip(bytes, (n) =>
    new RegExp(`fca_cia_aberta_valor_mobiliario_${year}\\.csv$`).test(n),
  );
  const text = [...files.values()][0];
  if (!text)
    throw new DataSourceError(
      `o FCA de ${year} não trouxe o arquivo de valores mobiliários`,
      CVM_SOURCE,
    );
  const best = new Map<string, { t: CvmTicker; active: boolean; id: number }>();
  for (const r of records(text)) {
    const cnpj = digits(r.CNPJ_Companhia ?? '');
    if (cnpj.length !== 14) continue;
    for (const raw of (r.Codigo_Negociacao ?? '').split(/[\s,;/]+/)) {
      const ticker = raw.toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(ticker)) continue;
      const cand = {
        t: {
          ticker,
          cnpj,
          shareClass: classOf(r.Valor_Mobiliario ?? '', r.Classe_Acao_Preferencial ?? '', ticker),
        },
        active: !r.Data_Fim_Negociacao,
        id: Number(r.ID_Documento) || 0,
      };
      const cur = best.get(ticker);
      if (!cur || (cand.active && !cur.active) || (cand.active === cur.active && cand.id > cur.id))
        best.set(ticker, cand);
    }
  }
  return new Map([...best].map(([k, v]) => [k, v.t]));
}

// ------------------------------------------------------------------ fatos para o core

export interface CvmFacts {
  facts: FundamentalFact[];
  notes: string[];
}

/** Rótulo do LPA bate com a classe? ("PN" não pode casar com "PNA"). */
const classLabel = (label: string, cls: CvmShareClass) =>
  new RegExp(`^${cls}(?![A-Z])`).test(norm(label));

/**
 * Fatos de uma companhia para uma classe de ação: receita (3.01) e LPA básico da classe. Consolidada
 * é preferida à individual (rank 0 e 1); séries de demonstrações diferentes nunca se misturam.
 */
export function cvmFactsFor(lines: readonly CvmDreLine[], cls: CvmShareClass | null): CvmFacts {
  const facts: FundamentalFact[] = [];
  const notes: string[] = [];
  const rank = (st: CvmDreLine['statement']) => (st === 'con' ? 0 : 1);
  const labels = new Set<string>();
  for (const l of lines) {
    if (l.code !== '3.01') continue;
    labels.add(l.label);
    facts.push({
      metric: 'revenue',
      concept: `${l.statement}:3.01`,
      rank: rank(l.statement),
      start: l.start,
      end: l.end,
      value: l.value,
      doc: l.doc,
      filed: l.filed,
    });
  }
  const other = [...labels].filter(
    (x) => norm(x) !== norm('Receita de Venda de Bens e/ou Serviços'),
  );
  if (other.length)
    notes.push(
      `Receita = conta 3.01 "${other[0]}" (não é receita de vendas; ex.: banco ou seguradora).`,
    );

  if (cls === 'UNIT')
    notes.push('LPA: units juntam ações ON e PN; a CVM não publica LPA por unit.');
  else if (cls === null) notes.push('LPA: classe da ação não identificada no cadastro da CVM.');
  else {
    // por documento e demonstração: a linha da classe; se não houver e o ticker for de preferencial,
    // aceita a única linha "PN…" do documento (empresa com uma classe só de preferenciais)
    const groups = new Map<string, CvmDreLine[]>();
    for (const l of lines) {
      if (!l.code.startsWith('3.99.01.')) continue;
      const k = `${l.doc}|${l.statement}|${l.start}|${l.end}`;
      const g = groups.get(k);
      if (g) g.push(l);
      else groups.set(k, [l]);
    }
    for (const g of groups.values()) {
      let hit = g.find((l) => classLabel(l.label, cls));
      if (!hit && cls.startsWith('PN')) {
        const pns = g.filter((l) => norm(l.label).startsWith('PN'));
        if (pns.length === 1) hit = pns[0];
      }
      if (!hit) continue;
      facts.push({
        metric: 'eps',
        concept: `${hit.statement}:LPA ${cls}`,
        rank: rank(hit.statement),
        start: hit.start,
        end: hit.end,
        value: hit.value,
        doc: hit.doc,
        filed: hit.filed,
      });
    }
  }
  return { facts, notes };
}

// ------------------------------------------------------------------ cliente

export class CvmClient {
  private readonly http: HttpClient;
  private readonly base: string;

  constructor(
    opts: {
      fetch?: FetchFn;
      base?: string;
      retries?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {
    this.base = opts.base ?? CVM_BASE;
    this.http = new HttpClient({
      source: CVM_SOURCE,
      // a CVM não publica limite; arquivos grandes, poucos pedidos (decisão nossa)
      maxRequests: 2,
      perMs: 1000,
      timeoutMs: 120_000,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
  }

  /** DFP de um ano de referência (a DFP de 2025 é entregue em 2026). */
  async dfp(year: number): Promise<CvmDfp> {
    const bytes = await this.http.getBytes(`${this.base}/DFP/DADOS/${dfpZipName(year)}`);
    return parseDfpZip(bytes, year);
  }

  /** Documentos eventuais (IPE) entregues num ano. */
  async ipe(year: number): Promise<CvmIpeEvent[]> {
    const bytes = await this.http.getBytes(`${this.base}/IPE/DADOS/${ipeZipName(year)}`);
    return parseIpeZip(bytes, year);
  }

  /** Mapa ticker → CNPJ e classe do FCA de um ano. */
  async fca(year: number): Promise<Map<string, CvmTicker>> {
    const bytes = await this.http.getBytes(`${this.base}/FCA/DADOS/${fcaZipName(year)}`);
    return parseFcaZip(bytes, year);
  }
}

/**
 * Documento eventual da CVM (IPE): fatos relevantes, comunicados etc. A CVM informa só a DATA de
 * entrega (DATA_SOURCES §19: atualização semanal; serve para histórico, não para alerta).
 */
export interface CvmIpeEvent {
  cnpj: string;
  company: string;
  category: string;
  type: string;
  subject: string;
  /** Data de entrega (meia-noite UTC, como os candles diários — ADR-0006). */
  deliveredAt: number;
  link: string | null;
}

/** Colunas que o leitor exige (os nomes vêm do dicionário de dados da CVM; 🔌 até o teste real). */
export const IPE_REQUIRED = ['CNPJ_Companhia', 'Categoria', 'Data_Entrega'] as const;

/** Lê o zip anual do IPE. Erro claro se a CVM mudar o nome das colunas exigidas. */
export function parseIpeZip(bytes: Uint8Array, year: number): CvmIpeEvent[] {
  const files = unzip(bytes, (n) => new RegExp(`ipe_cia_aberta_${year}\\.csv$`).test(n));
  const text = [...files.values()][0];
  if (!text)
    throw new DataSourceError(`o IPE de ${year} não trouxe o arquivo esperado`, CVM_SOURCE);
  const head = (parseCsv(text.slice(0, 2000))[0] ?? []).map((h) => h.trim());
  const missing = IPE_REQUIRED.filter((c) => !head.includes(c));
  if (missing.length)
    throw new DataSourceError(
      `o IPE de ${year} mudou de formato: faltam as colunas ${missing.join(', ')} (veio: ${head.join(', ')})`,
      CVM_SOURCE,
    );
  const out: CvmIpeEvent[] = [];
  for (const r of records(text)) {
    const cnpj = digits(r.CNPJ_Companhia ?? '');
    const day = isoDay(r.Data_Entrega);
    if (cnpj.length !== 14 || day === null) continue;
    out.push({
      cnpj,
      company: r.Nome_Companhia ?? '',
      category: r.Categoria ?? '',
      type: r.Tipo ?? '',
      subject: r.Assunto ?? '',
      deliveredAt: day,
      link: r.Link_Download || null,
    });
  }
  return out;
}

/** Fato relevante? (categoria normalizada, sem acento) */
export const isFatoRelevante = (e: CvmIpeEvent) => norm(e.category) === 'FATO RELEVANTE';

/** Ticker da B3 sem o "F" do mercado fracionário (PETR4F → PETR4). */
export const b3BaseTicker = (t: string) =>
  t
    .trim()
    .toUpperCase()
    .replace(/^([A-Z0-9]{4}\d{1,2})F$/, '$1');
