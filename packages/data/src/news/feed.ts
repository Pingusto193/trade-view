import { XMLParser } from 'fast-xml-parser';
import type { FetchFn } from '../http';
import { DataSourceError } from '../types';

/**
 * Leitor de feeds RSS 2.0, RSS 1.0 (RDF) e Atom para as notícias (ADR-0032). Guarda só título, link,
 * data e um trecho curto do próprio feed. O DOCTYPE é removido antes de ler (sem expansão de entidades
 * declaradas no documento: feed legítimo não precisa disso).
 */

export interface RawNews {
  guid: string | null;
  url: string;
  title: string;
  /** Trecho do feed sem HTML, até 300 caracteres. */
  snippet: string | null;
  /** UTC ms; null se a fonte não informa ou informa algo ilegível (nunca inventamos). */
  publishedAt: number | null;
  categories: string[];
  /** Texto do resumo do feed sem corte (só para leitores específicos, ex.: SEC 8-K). */
  rawSummary: string | null;
}

export const SNIPPET_MAX = 300;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  isArray: (name) => ['item', 'entry', 'link', 'category'].includes(name),
  // conteúdo bruto (HTML/XHTML embutido, CDATA): a limpeza é do stripHtml, que preserva a ordem do texto
  stopNodes: ['*.title', '*.description', '*.summary', '*.content', '*.content:encoded'],
});

type Node = Record<string, unknown>;

/** Texto de um nó (string, número ou { '#text' }). */
function text(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text((v as Node)['#text']);
  return '';
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

const decode = (s: string) =>
  s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));

/**
 * Tira tags HTML, decodifica entidades e junta espaços. Decodifica antes (HTML escapado dentro do feed,
 * "&lt;p&gt;") e depois (entidades dentro do HTML).
 */
export function stripHtml(html: string): string {
  const once = html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const unescaped = /&lt;[a-z/!]/i.test(once) ? decode(once) : once;
  return decode(
    unescaped
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Corta em até `max` caracteres na última palavra inteira, com reticências. */
export function clip(s: string, max = SNIPPET_MAX): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** Fusos que aparecem em feeds e o Date.parse não conhece. */
const TZ_ABBR: Record<string, string> = {
  BRT: '-0300',
  BRST: '-0200',
  EST: '-0500',
  EDT: '-0400',
  CST: '-0600',
  CDT: '-0500',
  PST: '-0800',
  PDT: '-0700',
};

/** Data de RSS (RFC 822) ou Atom (ISO 8601) → UTC ms, ou null. */
export function parseFeedDate(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  let t = Date.parse(s);
  if (Number.isNaN(t)) {
    const m = /\s([A-Z]{3,4})$/.exec(s);
    const off = m ? TZ_ABBR[m[1] as string] : undefined;
    if (off) t = Date.parse(s.replace(/\s[A-Z]{3,4}$/, ` ${off}`));
  }
  return Number.isNaN(t) ? null : t;
}

function atomLink(links: unknown): string {
  const list = (Array.isArray(links) ? links : [links]) as Node[];
  const alt =
    list.find((l) => l && (l['@_rel'] === undefined || l['@_rel'] === 'alternate')) ?? list[0];
  return alt ? text(alt['@_href'] ?? alt) : '';
}

function rssItem(it: Node): RawNews | null {
  const url = text(it.link).trim();
  const title = stripHtml(text(it.title));
  if (!url || !title) return null;
  const summary = text(it.description) || text(it['content:encoded']);
  const snippet = summary ? clip(stripHtml(summary)) : null;
  return {
    guid: text(it.guid) || null,
    url,
    title,
    snippet: snippet || null,
    publishedAt: parseFeedDate(text(it.pubDate) || text(it['dc:date'])),
    categories: ((it.category as unknown[]) ?? []).map(text).filter(Boolean),
    rawSummary: summary || null,
  };
}

function atomEntry(e: Node): RawNews | null {
  const url = atomLink(e.link).trim();
  const title = stripHtml(text(e.title));
  if (!url || !title) return null;
  const summary = text(e.summary) || text(e.content);
  const snippet = summary ? clip(stripHtml(summary)) : null;
  return {
    guid: text(e.id) || null,
    url,
    title,
    snippet: snippet || null,
    publishedAt: parseFeedDate(text(e.published) || text(e.updated)),
    categories: ((e.category as Node[]) ?? []).map((c) => text(c['@_term'] ?? c)).filter(Boolean),
    rawSummary: summary || null,
  };
}

/** Lê um feed RSS 2.0, RSS 1.0 (RDF) ou Atom. Itens sem link ou sem título são descartados. */
export function parseFeed(xml: string): RawNews[] {
  const clean = xml.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '');
  let doc: Node;
  try {
    doc = parser.parse(clean) as Node;
  } catch (e) {
    throw new Error(`feed ilegível: ${(e as Error).message}`, { cause: e });
  }
  const rss = doc.rss as Node | undefined;
  if (rss) {
    const items = ((rss.channel as Node | undefined)?.item as Node[]) ?? [];
    return items.map(rssItem).filter((x): x is RawNews => x !== null);
  }
  const rdf = doc['rdf:RDF'] as Node | undefined;
  if (rdf) return ((rdf.item as Node[]) ?? []).map(rssItem).filter((x): x is RawNews => !!x);
  const feed = doc.feed as Node | undefined;
  if (feed) return ((feed.entry as Node[]) ?? []).map(atomEntry).filter((x): x is RawNews => !!x);
  throw new Error('não é RSS nem Atom');
}

// ------------------------------------------------------------------ busca condicional

export interface ConditionalState {
  etag?: string | null;
  lastModified?: string | null;
}

export type FetchFeedResult =
  { status: 304 } | { status: 200; body: string; etag: string | null; lastModified: string | null };

const MAX_BYTES = 5_000_000;

/**
 * GET condicional (If-None-Match / If-Modified-Since): quando nada mudou a fonte responde 304 e não
 * reenvia o feed (economiza a fonte e a nossa banda).
 */
export async function fetchFeed(
  url: string,
  opts: ConditionalState & {
    source: string;
    userAgent: string;
    fetch?: FetchFn;
    timeoutMs?: number;
  },
): Promise<FetchFeedResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await (opts.fetch ?? ((u, i) => fetch(u, i)))(url, {
      headers: {
        'user-agent': opts.userAgent,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        ...(opts.etag ? { 'if-none-match': opts.etag } : {}),
        ...(opts.lastModified ? { 'if-modified-since': opts.lastModified } : {}),
      },
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new DataSourceError(
      `Falha de rede ao acessar ${opts.source}: ${(e as Error).message}`,
      opts.source,
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 304) return { status: 304 };
  if (!res.ok)
    throw new DataSourceError(
      `${opts.source} respondeu HTTP ${res.status}`,
      opts.source,
      res.status,
    );
  const body = await res.text();
  if (body.length > MAX_BYTES)
    throw new DataSourceError(`${opts.source}: feed grande demais`, opts.source);
  return {
    status: 200,
    body,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
}

// ------------------------------------------------------------------ SEC EDGAR 8-K

/** Itens do 8-K mais comuns (formulário oficial da SEC). */
const SEC_ITEMS: Record<string, string> = {
  '1.01': 'acordo relevante',
  '1.03': 'falência ou recuperação',
  '2.01': 'aquisição ou venda de ativos',
  '2.02': 'resultados',
  '2.05': 'reestruturação',
  '2.06': 'baixa contábil relevante',
  '3.01': 'risco de deslistagem',
  '4.02': 'demonstrações não confiáveis',
  '5.02': 'mudança de diretores',
  '7.01': 'divulgação (Reg FD)',
  '8.01': 'outros eventos',
};

export interface Sec8kInfo {
  cik: number | null;
  company: string;
  items: { code: string; label: string }[];
}

/** "8-K - APPLE INC (0000320193) (Filer)" + resumo com "Item 2.02" → empresa, CIK e itens. */
export function parseSec8k(raw: RawNews): Sec8kInfo {
  const m = /^8-K(?:\/A)?\s*-\s*(.+?)\s*\((\d{4,10})\)/.exec(raw.title);
  const items = [...(raw.rawSummary ?? '').matchAll(/Item\s+(\d\.\d\d)/gi)].map((x) => {
    const code = x[1] as string;
    return { code, label: SEC_ITEMS[code] ?? 'item' };
  });
  const uniq = items.filter((x, i) => items.findIndex((y) => y.code === x.code) === i);
  return { cik: m ? Number(m[2]) : null, company: m ? (m[1] as string) : raw.title, items: uniq };
}
