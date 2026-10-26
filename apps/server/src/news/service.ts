import { createHash } from 'node:crypto';
import {
  assetTagKey,
  type AssetTag,
  type NewsItem,
  type NewsQuery,
  type NewsSourceStatus,
} from '@radar/shared';
import {
  canonicalUrl,
  delayStats,
  findDuplicate,
  interestTags,
  tagText,
  type DedupeCandidate,
} from '@radar/core';
import {
  fetchFeed,
  parseFeed,
  parseSec8k,
  simulatedNews,
  type FetchFn,
  type NewsSourceDef,
  type RawNews,
} from '@radar/data';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { newsItems, newsSources, newsTags } from '../db/schema';

const DAY = 86_400_000;
/** Janela de comparação da deduplicação (as notícias recentes de todas as fontes). */
const DEDUPE_WINDOW = 2 * DAY;
/** Espera máxima entre tentativas quando a fonte falha (multiplica o intervalo). */
const MAX_BACKOFF = 8;

export interface NewsServiceOptions {
  sources: readonly NewsSourceDef[];
  userAgent: string;
  secUserAgent?: string;
  fetch?: FetchFn;
  now?: () => number;
  /** CIK → ticker (SEC company_tickers.json), carregado sob demanda. */
  cikTickers?: () => Promise<Map<number, string>>;
  /** Avisado quando chegam notícias novas (não acervo). */
  onNew?: (items: NewsItem[]) => void;
  log?: { warn(msg: string): void; info(msg: string): void };
  random?: () => number;
}

type Row = typeof newsItems.$inferSelect;

const toItem = (r: Row, labels: Map<string, string>): NewsItem => ({
  id: r.id,
  sourceId: r.sourceId,
  sourceLabel: labels.get(r.sourceId) ?? r.sourceId,
  kind: r.kind as NewsItem['kind'],
  lang: r.lang as NewsItem['lang'],
  url: r.url,
  title: r.title,
  snippet: r.snippet,
  publishedAt: r.publishedAt,
  arrivedAt: r.arrivedAt,
  backlog: r.backlog,
  tags: JSON.parse(r.tags) as AssetTag[],
  duplicateOf: r.duplicateOf,
});

/**
 * Ingestão contínua de notícias (SPEC §23.1, ADR-0032): GET condicional por fonte, leitura, URL
 * canônica, deduplicação entre fontes, etiquetas de ativos e atraso por fonte. Guarda só título, link,
 * datas e trecho curto do feed.
 */
export class NewsService {
  private readonly now: () => number;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly failures = new Map<string, number>();
  private readonly labels: Map<string, string>;
  private cik: Map<number, string> | null = null;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly opts: NewsServiceOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.labels = new Map(opts.sources.map((s) => [s.id, s.label]));
  }

  nowMs(): number {
    return this.now();
  }

  /** Motivo de a fonte estar desligada (null = ligada). */
  disabledReason(s: NewsSourceDef): string | null {
    if (s.requires === 'SEC_USER_AGENT' && !this.opts.secUserAgent)
      return 'defina SEC_USER_AGENT no .env (nome e e-mail de contato; esta fonte recusa robôs sem ele)';
    return null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    let i = 0;
    for (const s of this.opts.sources) {
      if (this.disabledReason(s)) continue;
      // espalha a primeira leitura (não bate em todas as fontes no mesmo segundo)
      this.schedule(s, 2_000 + i++ * 3_000);
    }
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private schedule(s: NewsSourceDef, delay: number): void {
    const t = setTimeout(() => {
      void this.poll(s.id)
        .catch(() => undefined)
        .finally(() => {
          if (!this.running) return;
          const fails = this.failures.get(s.id) ?? 0;
          const mult = Math.min(2 ** fails, MAX_BACKOFF);
          const jitter = 0.9 + (this.opts.random ?? Math.random)() * 0.2;
          this.schedule(s, s.intervalMs * mult * jitter);
        });
    }, delay);
    t.unref?.();
    this.timers.set(s.id, t);
  }

  private state(id: string) {
    return this.db.select().from(newsSources).where(eq(newsSources.id, id)).get();
  }

  private async raw(s: NewsSourceDef): Promise<{ items: RawNews[]; notModified: boolean }> {
    if (s.reader === 'sim') return { items: simulatedNews(this.now()), notModified: false };
    const st = this.state(s.id);
    const ua =
      s.requires === 'SEC_USER_AGENT' ? (this.opts.secUserAgent ?? '') : this.opts.userAgent;
    const r = await fetchFeed(s.url, {
      source: s.label,
      userAgent: ua,
      etag: st?.etag ?? null,
      lastModified: st?.lastModified ?? null,
      ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
    });
    if (r.status === 304) return { items: [], notModified: true };
    this.db
      .update(newsSources)
      .set({ etag: r.etag, lastModified: r.lastModified })
      .where(eq(newsSources.id, s.id))
      .run();
    return { items: parseFeed(r.body), notModified: false };
  }

  private async secTags(raw: RawNews): Promise<{ tags: AssetTag[]; title: string }> {
    const info = parseSec8k(raw);
    if (!this.cik && this.opts.cikTickers) {
      try {
        this.cik = await this.opts.cikTickers();
      } catch {
        this.cik = null; // sem o mapa, a notícia entra sem o código (nunca inventado)
      }
    }
    const ticker = info.cik !== null ? this.cik?.get(info.cik) : undefined;
    const items = info.items.map((i) => `${i.code} ${i.label}`).join('; ');
    return {
      tags: ticker ? [{ type: 'ticker', value: ticker }] : [],
      title: `8-K ${info.company}${ticker ? ` (${ticker})` : ''}${items ? ` — ${items}` : ''}`,
    };
  }

  /** Lê uma fonte agora. Devolve quantas notícias novas entraram. */
  async poll(id: string): Promise<{ added: number; notModified: boolean }> {
    const s = this.opts.sources.find((x) => x.id === id);
    if (!s) throw new Error(`fonte desconhecida: ${id}`);
    const reason = this.disabledReason(s);
    if (reason) throw new Error(`fonte desligada: ${reason}`);
    const now = this.now();
    if (!this.state(id)) this.db.insert(newsSources).values({ id }).run();
    this.db.update(newsSources).set({ lastPollAt: now }).where(eq(newsSources.id, id)).run();
    let fetched: { items: RawNews[]; notModified: boolean };
    try {
      fetched = await this.raw(s);
    } catch (e) {
      this.failures.set(id, (this.failures.get(id) ?? 0) + 1);
      this.db
        .update(newsSources)
        .set({ lastError: (e as Error).message.slice(0, 300) })
        .where(eq(newsSources.id, id))
        .run();
      this.opts.log?.warn(`notícias: ${s.label}: ${(e as Error).message}`);
      throw e;
    }
    this.failures.delete(id);
    const st = this.state(id);
    // primeira leitura bem-sucedida: o que já está no feed é acervo
    const firstOk = !st?.lastOkAt;
    const firstPollAt = st?.firstPollAt ?? now;
    const recent: DedupeCandidate[] = this.db
      .select({
        id: newsItems.id,
        url: newsItems.url,
        title: newsItems.title,
        publishedAt: newsItems.publishedAt,
        arrivedAt: newsItems.arrivedAt,
      })
      .from(newsItems)
      .where(and(gt(newsItems.arrivedAt, now - DEDUPE_WINDOW), isNull(newsItems.duplicateOf)))
      .all();
    const added: NewsItem[] = [];
    for (const raw of fetched.items) {
      const canon = canonicalUrl(raw.url);
      const exists = this.db
        .select({ id: newsItems.id })
        .from(newsItems)
        .where(and(eq(newsItems.sourceId, id), eq(newsItems.canonicalUrl, canon)))
        .get();
      if (exists) continue;
      let title = raw.title;
      let extra: AssetTag[] = [...(s.baseTags ?? [])];
      if (s.reader === 'sim') {
        // ativos simulados ("SIMBTC") não seguem o padrão de códigos reais
        for (const m of title.matchAll(/\bSIM(?!ULADO)[A-Z]{2,6}\b/g))
          extra.push({ type: 'ticker', value: m[0] });
      }
      if (s.reader === 'sec-8k') {
        const sec = await this.secTags(raw);
        title = sec.title;
        extra = [...extra, ...sec.tags];
      }
      const itemId = createHash('sha256').update(`${id}|${canon}`).digest('hex').slice(0, 24);
      const cand: DedupeCandidate = {
        id: itemId,
        url: raw.url,
        title,
        publishedAt: raw.publishedAt,
        arrivedAt: now,
      };
      const dup = findDuplicate(cand, recent);
      const backlog = firstOk || (raw.publishedAt !== null && raw.publishedAt < firstPollAt);
      const tags = tagText(`${title} ${raw.snippet ?? ''}`, extra, s.lang);
      const item: NewsItem = {
        id: itemId,
        sourceId: id,
        sourceLabel: s.label,
        kind: s.kind,
        lang: s.lang,
        url: raw.url,
        title,
        snippet: raw.snippet,
        publishedAt: raw.publishedAt,
        arrivedAt: now,
        backlog,
        tags,
        duplicateOf: dup,
      };
      this.db.transaction((tx) => {
        tx.insert(newsItems)
          .values({
            id: itemId,
            sourceId: id,
            kind: s.kind,
            lang: s.lang,
            url: raw.url,
            canonicalUrl: canon,
            title,
            snippet: raw.snippet,
            publishedAt: raw.publishedAt,
            arrivedAt: now,
            backlog,
            duplicateOf: dup,
            tags: JSON.stringify(tags),
          })
          .onConflictDoNothing()
          .run();
        for (const t of tags)
          tx.insert(newsTags)
            .values({ newsId: itemId, tag: assetTagKey(t) })
            .onConflictDoNothing()
            .run();
      });
      if (!dup) recent.push(cand);
      added.push(item);
    }
    this.db
      .update(newsSources)
      .set({ lastOkAt: now, lastError: null, firstPollAt })
      .where(eq(newsSources.id, id))
      .run();
    const fresh = added.filter((x) => !x.backlog && !x.duplicateOf);
    if (fresh.length) this.opts.onNew?.(fresh);
    return { added: added.length, notModified: fetched.notModified };
  }

  /** Feed: mais novas primeiro (pela publicação, ou chegada se a fonte não informa). */
  query(q: NewsQuery): NewsItem[] {
    const conds = [];
    if (!q.duplicates) conds.push(isNull(newsItems.duplicateOf));
    if (q.kinds?.length) conds.push(inArray(newsItems.kind, q.kinds));
    if (q.since !== undefined)
      conds.push(sql`coalesce(${newsItems.publishedAt}, ${newsItems.arrivedAt}) >= ${q.since}`);
    if (q.symbols?.length) {
      const tags = [
        ...new Set(q.symbols.flatMap((s) => interestTags(s).map((t) => assetTagKey(t)))),
      ];
      if (!tags.length) return [];
      conds.push(
        inArray(
          newsItems.id,
          this.db.select({ id: newsTags.newsId }).from(newsTags).where(inArray(newsTags.tag, tags)),
        ),
      );
    }
    const rows = this.db
      .select()
      .from(newsItems)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(sql`coalesce(${newsItems.publishedAt}, ${newsItems.arrivedAt})`))
      .limit(q.limit)
      .all();
    return rows.map((r) => toItem(r, this.labels));
  }

  /** Saúde de cada fonte + atraso medido nos últimos 7 dias. */
  sources(): NewsSourceStatus[] {
    const now = this.now();
    return this.opts.sources.map((s) => {
      const st = this.state(s.id);
      const rows = this.db
        .select({
          publishedAt: newsItems.publishedAt,
          arrivedAt: newsItems.arrivedAt,
          backlog: newsItems.backlog,
        })
        .from(newsItems)
        .where(and(eq(newsItems.sourceId, s.id), gt(newsItems.arrivedAt, now - 7 * DAY)))
        .all();
      const d = delayStats(rows);
      return {
        id: s.id,
        label: s.label,
        kind: s.kind,
        lang: s.lang,
        enabled: !this.disabledReason(s),
        disabledReason: this.disabledReason(s),
        intervalMs: s.intervalMs,
        lastPollAt: st?.lastPollAt ?? null,
        lastOkAt: st?.lastOkAt ?? null,
        lastError: st?.lastError ?? null,
        items24h: rows.filter((r) => r.arrivedAt > now - DAY).length,
        delay: { n: d.n, medianMs: d.medianMs, p90Ms: d.p90Ms },
        terms: s.terms,
      };
    });
  }
}
