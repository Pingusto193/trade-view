import { randomUUID } from 'node:crypto';
import {
  DAY_MS,
  applyFilters,
  closedCandles,
  isPeriodClosed,
  lastClosedSession,
  periodKey,
  scanSymbol,
  weeklyFromDaily,
  type Fundamentals,
  type SetupParams,
} from '@radar/core';
import {
  FEED_STATE_LABEL,
  SCAN_MAX_INTRADAY_SYMBOLS,
  SCAN_MAX_SYMBOLS,
  SUGGESTED_UNIVERSE_IDS,
  TIMEFRAME_LABEL,
  UNIVERSES,
  formatDateTime,
  isIntraday,
  type Candle,
  type FeedStatus,
  type SavedScan,
  type SavedScanInput,
  type ScanConfig,
  type ScanRow,
  type ScanRunInput,
  type ScanSnapshot,
  type ScanSourceInfo,
  type ScanTrigger,
  type ScanUniverse,
  type ScanUniverses,
  type ServerMessage,
  type SymbolMeta,
  type Timeframe,
} from '@radar/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import { scanResults, scans, watchlistItems, watchlists } from '../db/schema';
import type { MarketHub } from '../market/hub';
import type { MarketService } from '../market/service';
import { userSetupParams } from '../prefs';
import type { SyncHub } from '../sync';

/**
 * Candles pedidos por escala: aquecem MMA200 + inclinação (205), ADX, pivôs e os setups. No diário,
 * 600 dão também ~120 semanas para o semanal montado a partir dele (MMA50 semanal + 52 semanas).
 */
export const SCAN_BARS: Readonly<Record<Timeframe, number>> = {
  '1m': 500,
  '5m': 500,
  '15m': 500,
  '30m': 500,
  '60m': 500,
  '1d': 600,
  '1w': 400,
  '1M': 240,
};
/** Semanal pedido à parte (escalas intradiárias e mensal): ~5 anos. */
export const SCAN_WEEKLY_BARS = 260;
/** Mínimo de candles FECHADOS para haver linha (o mesmo do painel de contexto). */
export const SCAN_MIN_BARS = 31;
/** Folga depois do fechamento + atraso da fonte antes da agenda diária rodar (decisão nossa). */
export const SCHEDULE_MARGIN_MS = 5 * 60_000;
/** De quanto em quanto tempo a agenda diária confere se há pregão novo fechado. */
const TICK_MS = 60_000;

/** Erro com código HTTP (o tratador de erros do app devolve a mensagem). */
export class ScanError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

interface Job {
  key: string;
  userId: number;
  scanId: string | null;
  symbols: string[];
  trigger: ScanTrigger;
  /** true = recomeça a tabela; false = emenda as linhas varridas (agenda). */
  replace: boolean;
  onDone: ((rows: ScanRow[]) => void)[];
}

interface LiveSub {
  scanId: string;
  symbolId: string;
  lastSeen: number | null;
  off: () => void;
}

type ScanRowDb = typeof scans.$inferSelect;

const adhocKey = (userId: number) => `avulsa:${userId}`;
const savedKey = (id: string) => `salva:${id}`;
const delayMs = (m: SymbolMeta) => (m.delay.kind === 'delayed' ? m.delay.minutes * 60_000 : 0);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function failText(s: FeedStatus): string {
  return `${FEED_STATE_LABEL[s.state]}: ${s.message ?? 'sem detalhe'}${
    s.lastValidAt ? ` — último dado válido em ${formatDateTime(s.lastValidAt)}` : ''
  }`;
}

function sourceInfo(meta: SymbolMeta, status: FeedStatus): ScanSourceInfo {
  return {
    label: meta.sourceLabel,
    delay: meta.delay,
    volume: meta.volume,
    liveVolume: meta.liveVolume,
    adjusted: meta.adjusted,
    simulated: meta.delay.kind === 'simulated',
    status,
    notes: [...meta.notes],
  };
}

/**
 * Scanner multi-mercado no servidor (SPEC §14). Varre um ativo por vez (respeitando o cache e os
 * limites de cada fonte, ADR-0010), com a lógica de `@radar/core` (`scanSymbol`, `applyFilters`).
 * - Sob demanda: em segundo plano, com progresso; erro de um ativo vira linha de erro.
 * - Varreduras salvas com agenda: diária (a cada pregão fechado, pela sessão da fonte) e, só para
 *   listas, a cada candle intradiário fechado (assinatura de tempo real, como os alertas).
 * - Guarda o último resultado de cada varredura; servidor reiniciado no meio = erro explicado.
 */
export class ScannerService {
  /** Resultados em memória enquanto há execução na fila ou rodando. */
  private readonly live = new Map<string, ScanSnapshot>();
  private readonly queue: Job[] = [];
  private busy: Promise<void> | null = null;
  private readonly weeklyCache = new Map<string, { week: number; candles: Candle[] }>();
  private readonly subs = new Map<string, LiveSub>();
  private readonly pending = new Map<
    string,
    { symbols: Set<string>; timer: ReturnType<typeof setTimeout> }
  >();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private closed = false;
  private syncing: Promise<void> = Promise.resolve();
  private readonly stopSync: () => void;
  /** Espera depois de um fechamento intradiário para juntar os ativos que fecham juntos. */
  debounceMs = 3000;

  constructor(
    private readonly db: Db,
    private readonly market: MarketService,
    private readonly hub: MarketHub,
    private readonly sync: SyncHub,
    private readonly log: FastifyBaseLogger,
    private readonly simulated: boolean,
    private readonly now: () => number = Date.now,
  ) {
    // varreduras que estavam rodando quando o servidor caiu não vão terminar
    for (const r of this.db.select().from(scanResults).where(eq(scanResults.running, true)).all()) {
      const snap = JSON.parse(r.snapshot) as ScanSnapshot;
      this.persist(r.userId, r.key, {
        ...snap,
        running: null,
        lastRun: {
          trigger: snap.running?.trigger ?? 'manual',
          finishedAt: this.now(),
          status: 'error',
          error: 'Interrompida: o servidor reiniciou no meio da varredura.',
          symbols: snap.running?.done ?? 0,
        },
      });
    }
    this.stopSync = sync.onChange((_userId, msg) => {
      // a lista mudou: os ativos acompanhados a cada candle mudam junto
      if (msg.topic === 'watchlists') void this.syncSubscriptions();
    });
  }

  // ---------------------------------------------------------------- universos

  private items(listId: number): string[] {
    return this.db
      .select({ s: watchlistItems.symbolId })
      .from(watchlistItems)
      .where(eq(watchlistItems.watchlistId, listId))
      .orderBy(asc(watchlistItems.position))
      .all()
      .map((r) => r.s);
  }

  universes(userId: number): ScanUniverses {
    const lists = this.db
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, userId))
      .orderBy(asc(watchlists.position), asc(watchlists.id))
      .all();
    return {
      watchlists: lists.map((l) => ({ id: l.id, name: l.name, count: this.items(l.id).length })),
      suggested: SUGGESTED_UNIVERSE_IDS.filter((id) => id !== 'sim' || this.simulated).map(
        (id) => ({ id, label: UNIVERSES[id].label, count: UNIVERSES[id].symbols.length }),
      ),
      limits: { maxSymbols: SCAN_MAX_SYMBOLS, maxIntraday: SCAN_MAX_INTRADAY_SYMBOLS },
    };
  }

  /** Ativos do universo (sem repetição), cortados no limite por varredura. */
  resolve(
    userId: number,
    u: ScanUniverse,
  ): { label: string; symbols: string[]; truncated: number } {
    let label: string;
    let all: readonly string[];
    if (u.kind === 'watchlist') {
      const l = this.db
        .select()
        .from(watchlists)
        .where(and(eq(watchlists.id, u.id), eq(watchlists.userId, userId)))
        .get();
      if (!l) throw new ScanError('lista não encontrada', 404);
      label = `Lista: ${l.name}`;
      all = this.items(l.id);
    } else {
      if (u.id === 'sim' && !this.simulated)
        throw new ScanError('o conjunto simulado só existe em desenvolvimento', 400);
      label = UNIVERSES[u.id].label;
      all = UNIVERSES[u.id].symbols;
    }
    const uniq = [...new Set(all)];
    return {
      label,
      symbols: uniq.slice(0, SCAN_MAX_SYMBOLS),
      truncated: Math.max(0, uniq.length - SCAN_MAX_SYMBOLS),
    };
  }

  // ---------------------------------------------------------------- resultados

  private load(key: string): ScanSnapshot | null {
    const hit = this.live.get(key);
    if (hit) return hit;
    const row = this.db.select().from(scanResults).where(eq(scanResults.key, key)).get();
    return row ? (JSON.parse(row.snapshot) as ScanSnapshot) : null;
  }

  private persist(userId: number, key: string, snap: ScanSnapshot): void {
    const row = {
      key,
      userId,
      scanId: snap.scanId,
      running: snap.running !== null,
      updatedAt: snap.updatedAt,
      snapshot: JSON.stringify(snap),
    };
    this.db
      .insert(scanResults)
      .values(row)
      .onConflictDoUpdate({ target: scanResults.key, set: row })
      .run();
  }

  /** Cópia para a API, com os filtros da varredura aplicados pelo core. */
  private view(snap: ScanSnapshot): ScanSnapshot {
    return {
      ...snap,
      rows: snap.rows.map((r) => ({ ...r, filter: applyFilters(r.analysis, snap.config.filters) })),
    };
  }

  private isBusy(key: string): boolean {
    return Boolean(this.live.get(key)?.running) || this.queue.some((q) => q.key === key);
  }

  // ---------------------------------------------------------------- varredura avulsa

  runAdhoc(userId: number, input: ScanRunInput): ScanSnapshot {
    const key = adhocKey(userId);
    if (this.isBusy(key))
      throw new ScanError('Já existe uma varredura rodando. Espere ela terminar.', 409);
    const u = this.resolve(userId, input.universe);
    if (!u.symbols.length) throw new ScanError('o universo escolhido não tem ativos', 400);
    const snap: ScanSnapshot = {
      scanId: null,
      config: { universe: input.universe, tf: input.tf, filters: input.filters },
      universeLabel: u.label,
      rows: [],
      truncated: u.truncated,
      running: null,
      lastRun: null,
      updatedAt: this.now(),
    };
    this.enqueue(snap, userId, key, { symbols: u.symbols, trigger: 'manual', replace: true });
    return this.view(snap);
  }

  adhoc(userId: number): ScanSnapshot | null {
    const s = this.load(adhocKey(userId));
    return s ? this.view(s) : null;
  }

  // ---------------------------------------------------------------- varreduras salvas

  private savedRow(id: string): ScanRowDb | undefined {
    return this.db.select().from(scans).where(eq(scans.id, id)).get();
  }

  private own(userId: number, id: string): ScanRowDb {
    const r = this.savedRow(id);
    if (!r || r.userId !== userId) throw new ScanError('varredura não encontrada', 404);
    return r;
  }

  private toSaved(r: ScanRowDb): SavedScan {
    const snap = this.load(savedKey(r.id));
    const config = JSON.parse(r.config) as ScanConfig;
    const rows = snap ? this.view(snap).rows : [];
    return {
      id: r.id,
      name: r.name,
      config,
      schedule: r.schedule,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      summary: {
        rows: rows.length,
        pass: rows.filter((x) => x.filter?.pass).length,
        chartOnly: rows.filter((x) => x.filter?.chartOnly).length,
        errors: rows.filter((x) => x.error).length,
        updatedAt: snap?.lastRun?.finishedAt ?? null,
        running: Boolean(snap?.running),
      },
    };
  }

  listSaved(userId: number): SavedScan[] {
    return this.db
      .select()
      .from(scans)
      .where(eq(scans.userId, userId))
      .orderBy(asc(scans.createdAt))
      .all()
      .map((r) => this.toSaved(r));
  }

  private freshSnap(r: ScanRowDb): ScanSnapshot {
    const config = JSON.parse(r.config) as ScanConfig;
    let label: string;
    let truncated = 0;
    try {
      const u = this.resolve(r.userId, config.universe);
      label = u.label;
      truncated = u.truncated;
    } catch (err) {
      label = (err as Error).message;
    }
    return {
      scanId: r.id,
      config,
      universeLabel: label,
      rows: [],
      truncated,
      running: null,
      lastRun: null,
      updatedAt: this.now(),
    };
  }

  createSaved(userId: number, input: SavedScanInput): SavedScan {
    this.resolve(userId, input.universe);
    const id = randomUUID();
    const t = this.now();
    const config: ScanConfig = { universe: input.universe, tf: input.tf, filters: input.filters };
    this.db
      .insert(scans)
      .values({
        id,
        userId,
        name: input.name,
        config: JSON.stringify(config),
        schedule: input.schedule,
        createdAt: t,
        updatedAt: t,
      })
      .run();
    if (input.schedule === 'intraday') {
      void this.syncSubscriptions();
      this.runSaved(userId, id, 'intraday');
    }
    return this.toSaved(this.own(userId, id));
  }

  updateSaved(userId: number, id: string, input: SavedScanInput): SavedScan {
    const r = this.own(userId, id);
    this.resolve(userId, input.universe);
    const prev = JSON.parse(r.config) as ScanConfig;
    const sameData =
      prev.tf === input.tf && JSON.stringify(prev.universe) === JSON.stringify(input.universe);
    const key = savedKey(id);
    if (!sameData && this.isBusy(key))
      throw new ScanError(
        'A varredura está rodando: espere terminar para trocar o universo ou a escala.',
        409,
      );
    const config: ScanConfig = { universe: input.universe, tf: input.tf, filters: input.filters };
    this.db
      .update(scans)
      .set({
        name: input.name,
        config: JSON.stringify(config),
        schedule: input.schedule,
        updatedAt: this.now(),
        ...(sameData ? {} : { autoState: '{}' }),
      })
      .where(eq(scans.id, id))
      .run();
    // filtros novos valem na hora (são aplicados ao ler); universo ou escala novos zeram a tabela
    const snap = this.load(key);
    if (snap) {
      snap.config = config;
      if (!sameData) {
        snap.rows = [];
        snap.lastRun = null;
        const u = this.resolve(userId, input.universe);
        snap.universeLabel = u.label;
        snap.truncated = u.truncated;
      }
      snap.updatedAt = this.now();
      this.persist(userId, key, snap);
    }
    if (input.schedule !== r.schedule || !sameData) void this.syncSubscriptions();
    if (
      input.schedule === 'intraday' &&
      (r.schedule !== 'intraday' || !sameData) &&
      !this.isBusy(key)
    )
      this.runSaved(userId, id, 'intraday');
    return this.toSaved(this.own(userId, id));
  }

  removeSaved(userId: number, id: string): void {
    this.own(userId, id);
    const key = savedKey(id);
    for (let i = this.queue.length - 1; i >= 0; i--)
      if (this.queue[i]!.key === key) this.queue.splice(i, 1);
    this.db.delete(scans).where(eq(scans.id, id)).run(); // o resultado vai junto (cascade)
    this.live.delete(key);
    void this.syncSubscriptions();
  }

  /** Roda a varredura salva inteira agora (tabela recomeça). */
  runSaved(userId: number, id: string, trigger: ScanTrigger = 'manual'): ScanSnapshot {
    const r = this.own(userId, id);
    const key = savedKey(id);
    if (this.isBusy(key))
      throw new ScanError('Esta varredura já está rodando. Espere ela terminar.', 409);
    const config = JSON.parse(r.config) as ScanConfig;
    const u = this.resolve(userId, config.universe);
    if (!u.symbols.length) throw new ScanError('o universo escolhido não tem ativos', 400);
    const snap = this.load(key) ?? this.freshSnap(r);
    snap.config = config;
    snap.universeLabel = u.label;
    snap.truncated = u.truncated;
    this.enqueue(snap, userId, key, { symbols: u.symbols, trigger, replace: true });
    return this.view(snap);
  }

  savedResult(userId: number, id: string): ScanSnapshot | null {
    this.own(userId, id);
    const s = this.load(savedKey(id));
    return s ? this.view(s) : null;
  }

  // ---------------------------------------------------------------- fila (um ativo por vez)

  private enqueue(
    snap: ScanSnapshot,
    userId: number,
    key: string,
    j: {
      symbols: string[];
      trigger: ScanTrigger;
      replace: boolean;
      onDone?: (r: ScanRow[]) => void;
    },
  ): void {
    const waiting = this.queue.find((q) => q.key === key);
    if (waiting) {
      // junta com o trabalho da mesma varredura que ainda não começou
      if (j.replace)
        Object.assign(waiting, { symbols: [...j.symbols], trigger: j.trigger, replace: true });
      else for (const s of j.symbols) if (!waiting.symbols.includes(s)) waiting.symbols.push(s);
      if (j.onDone) waiting.onDone.push(j.onDone);
      return;
    }
    this.queue.push({
      key,
      userId,
      scanId: snap.scanId,
      symbols: [...j.symbols],
      trigger: j.trigger,
      replace: j.replace,
      onDone: j.onDone ? [j.onDone] : [],
    });
    this.live.set(key, snap);
    snap.running ??= {
      trigger: j.trigger,
      startedAt: null,
      done: 0,
      total: j.symbols.length,
      current: null,
    };
    this.persist(userId, key, snap);
    this.pump();
  }

  private pump(): void {
    if (this.busy || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = this.execute(job)
      .catch((err: unknown) => this.log.error({ err, key: job.key }, 'scanner: falha na execução'))
      .finally(() => {
        this.busy = null;
        this.pump();
      });
  }

  private async execute(job: Job): Promise<void> {
    const snap = this.live.get(job.key);
    if (!snap) return;
    snap.running = {
      trigger: job.trigger,
      startedAt: this.now(),
      done: 0,
      total: job.symbols.length,
      current: null,
    };
    if (job.replace) snap.rows = [];
    else if (job.scanId) {
      // agenda: tira da tabela quem saiu da lista
      try {
        const u = this.resolve(job.userId, snap.config.universe);
        snap.rows = snap.rows.filter((r) => u.symbols.includes(r.symbolId));
        snap.universeLabel = u.label;
        snap.truncated = u.truncated;
      } catch {
        // lista apagada: mantém o que havia; o erro aparece ao rodar de novo
      }
    }
    const done: ScanRow[] = [];
    let error: string | null = null;
    try {
      const params = userSetupParams(this.db, job.userId);
      for (const id of job.symbols) {
        if (this.closed) break;
        snap.running.current = id;
        const row = await this.scanOne(id, snap.config.tf, params, job.trigger);
        const i = snap.rows.findIndex((r) => r.symbolId === id);
        if (i >= 0) snap.rows[i] = row;
        else snap.rows.push(row);
        done.push(row);
        snap.running.done++;
        snap.updatedAt = this.now();
      }
    } catch (err) {
      error = (err as Error).message;
    }
    snap.lastRun = {
      trigger: job.trigger,
      finishedAt: this.now(),
      status: error ? 'error' : 'done',
      error,
      symbols: done.length,
    };
    const next = this.queue.find((q) => q.key === job.key);
    snap.running = next
      ? {
          trigger: next.trigger,
          startedAt: null,
          done: 0,
          total: next.symbols.length,
          current: null,
        }
      : null;
    if (job.scanId && !this.savedRow(job.scanId)) {
      this.live.delete(job.key); // apagada no meio do caminho
      return;
    }
    this.persist(job.userId, job.key, snap);
    if (!next) this.live.delete(job.key);
    for (const fn of job.onDone) fn(done);
    this.sync.notify(job.userId, { type: 'sync', topic: 'scanner' });
  }

  /** Fundamentos (SPEC §8.8): nenhuma fonte ligada ainda (SEC EDGAR/CVM na Fase 7) = não verificado. */
  private fundamentals(_symbolId: string): Fundamentals | null {
    return null;
  }

  /** Semanal FECHADO pedido à fonte; reaproveitado enquanto não fechar semana nova. */
  private async weekly(symbolId: string, meta: SymbolMeta, eff: number): Promise<Candle[]> {
    const wk = periodKey('1w', meta.session.timezone)(eff);
    const lastClosed = isPeriodClosed('1w', wk, meta.session, eff) ? wk : wk - 7 * DAY_MS;
    const hit = this.weeklyCache.get(symbolId);
    if (hit && hit.week === lastClosed) return hit.candles;
    const resp = await this.market.getCandles(symbolId, '1w', SCAN_WEEKLY_BARS);
    if (resp.status.state !== 'ok') throw new Error(failText(resp.status));
    const raw = resp.lastCandleOpen ? resp.candles.slice(0, -1) : resp.candles;
    const candles = closedCandles(raw, '1w', meta.session, eff);
    this.weeklyCache.set(symbolId, { week: lastClosed, candles });
    return candles;
  }

  /** Varre um ativo. Nunca lança: falha vira linha de erro com o motivo. */
  private async scanOne(
    symbolId: string,
    tf: Timeframe,
    params: SetupParams,
    trigger: ScanTrigger,
  ): Promise<ScanRow> {
    const at = this.now();
    const base: ScanRow = {
      symbolId,
      symbol: symbolId.split(':')[1] ?? symbolId,
      name: symbolId,
      market: null,
      source: null,
      analysis: null,
      error: null,
      notes: [],
      scannedAt: at,
      trigger,
    };
    let meta: SymbolMeta;
    try {
      meta = await this.market.getMeta(symbolId);
    } catch (err) {
      return { ...base, error: `ativo indisponível: ${(err as Error).message}` };
    }
    const head: ScanRow = { ...base, symbol: meta.symbol, name: meta.name, market: meta.market };
    if (!meta.timeframes.includes(tf))
      return {
        ...head,
        source: sourceInfo(meta, { state: 'ok' }),
        error: `${meta.sourceLabel} não oferece a escala ${TIMEFRAME_LABEL[tf]}`,
      };
    try {
      const resp = await this.market.getCandles(symbolId, tf, SCAN_BARS[tf]);
      const source = sourceInfo(resp.meta, resp.status);
      if (resp.status.state !== 'ok') return { ...head, source, error: failText(resp.status) };
      // dado atrasado só "enxerga" o mercado até agora − atraso
      const eff = at - delayMs(meta);
      const raw = resp.lastCandleOpen ? resp.candles.slice(0, -1) : resp.candles;
      const closed = closedCandles(raw, tf, meta.session, eff);
      if (closed.length < SCAN_MIN_BARS)
        return {
          ...head,
          source,
          error: `só ${closed.length} candles fechados nesta escala (mínimo ${SCAN_MIN_BARS})`,
        };
      const notes: string[] = [];
      let weekly: Candle[] | null = null;
      if (tf === '1d') weekly = weeklyFromDaily(closed, meta.session, eff);
      else if (tf !== '1w') {
        if (meta.timeframes.includes('1w'))
          weekly = await this.weekly(symbolId, meta, eff).catch((err: unknown) => {
            notes.push(`Semanal indisponível: ${(err as Error).message}`);
            return null;
          });
        else
          notes.push(
            `${meta.sourceLabel} não oferece o semanal: inclinações semanais e queda de 52 semanas ficam sem dado.`,
          );
      }
      const analysis = scanSymbol({
        candles: closed,
        weekly,
        tf,
        tz: meta.session.timezone,
        tick: meta.tickSize,
        params,
        fundamentals: this.fundamentals(symbolId),
        volume: resp.meta.volume,
      });
      return { ...head, source, analysis, notes };
    } catch (err) {
      return { ...head, error: `falha ao buscar candles: ${(err as Error).message}` };
    }
  }

  // ---------------------------------------------------------------- agenda

  /** Liga a agenda diária e as assinaturas intradiárias (partida do servidor). */
  start(): void {
    void this.syncSubscriptions();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  /**
   * Agenda diária: para cada ativo, o último pregão fechado pela sessão da fonte (com o atraso dela e
   * uma folga). Ativo com pregão novo desde a última rodada automática entra na fila. Uma tentativa
   * por pregão; se a fonte ainda não tiver o candle do dia, a linha mostra a data anterior.
   */
  async tick(): Promise<void> {
    if (this.ticking || this.closed) return;
    this.ticking = true;
    try {
      const t = this.now();
      for (const r of this.db.select().from(scans).where(eq(scans.schedule, 'daily')).all()) {
        const key = savedKey(r.id);
        if (this.isBusy(key)) continue;
        let u: ReturnType<ScannerService['resolve']>;
        try {
          u = this.resolve(r.userId, (JSON.parse(r.config) as ScanConfig).universe);
        } catch {
          continue;
        }
        const state = JSON.parse(r.autoState) as Record<string, number>;
        const marks: Record<string, number> = {};
        for (const s of u.symbols) {
          let mark: number;
          try {
            const meta = await this.market.getMeta(s);
            mark = lastClosedSession(meta.session, t - delayMs(meta) - SCHEDULE_MARGIN_MS);
          } catch {
            // ativo sem metadados: uma tentativa por dia (UTC), só para a linha de erro aparecer
            mark = Math.floor(t / DAY_MS) * DAY_MS;
          }
          if (mark > (state[s] ?? Number.NEGATIVE_INFINITY)) marks[s] = mark;
        }
        const due = Object.keys(marks);
        if (!due.length) continue;
        this.enqueue(this.load(key) ?? this.freshSnap(r), r.userId, key, {
          symbols: due,
          trigger: 'daily',
          replace: false,
          onDone: () => this.markAuto(r.id, marks),
        });
      }
    } finally {
      this.ticking = false;
    }
  }

  private markAuto(id: string, marks: Record<string, number>): void {
    const r = this.savedRow(id);
    if (!r) return;
    const state = { ...(JSON.parse(r.autoState) as Record<string, number>), ...marks };
    this.db
      .update(scans)
      .set({ autoState: JSON.stringify(state) })
      .where(eq(scans.id, id))
      .run();
  }

  /** Assina, no hub de tempo real, os ativos das varreduras com agenda intradiária. */
  syncSubscriptions(): Promise<void> {
    this.syncing = this.syncing
      .then(() => this.doSync())
      .catch((err: unknown) => this.log.warn({ err }, 'scanner: falha ao assinar os ativos'));
    return this.syncing;
  }

  private async doSync(): Promise<void> {
    if (this.closed) return;
    const want = new Map<string, { scanId: string; symbolId: string; tf: Timeframe }>();
    for (const r of this.db.select().from(scans).where(eq(scans.schedule, 'intraday')).all()) {
      const cfg = JSON.parse(r.config) as ScanConfig;
      if (cfg.universe.kind !== 'watchlist' || !isIntraday(cfg.tf)) continue;
      let symbols: string[];
      try {
        symbols = this.resolve(r.userId, cfg.universe).symbols.slice(0, SCAN_MAX_INTRADAY_SYMBOLS);
      } catch {
        continue;
      }
      for (const s of symbols) {
        const meta = await this.market.getMeta(s).catch(() => null);
        if (!meta?.timeframes.includes(cfg.tf)) continue;
        want.set(`${r.id}|${s}|${cfg.tf}`, { scanId: r.id, symbolId: s, tf: cfg.tf });
      }
    }
    for (const [k, sub] of this.subs)
      if (!want.has(k)) {
        sub.off();
        this.subs.delete(k);
      }
    for (const [k, w] of want) {
      if (this.subs.has(k) || this.closed) continue;
      const sub: LiveSub = {
        scanId: w.scanId,
        symbolId: w.symbolId,
        lastSeen: null,
        off: () => {},
      };
      this.subs.set(k, sub);
      sub.off = this.hub.subscribe(w.symbolId, w.tf, (m) => this.onLive(sub, m));
    }
  }

  /** Ativos acompanhados a cada candle (diagnóstico e testes). */
  get liveSymbols(): string[] {
    return [...this.subs.keys()];
  }

  private onLive(sub: LiveSub, m: ServerMessage): void {
    if (m.type !== 'candle' || !m.closed) return;
    if (sub.lastSeen !== null && m.candle.time <= sub.lastSeen) return; // repetido ou reconexão
    sub.lastSeen = m.candle.time;
    let p = this.pending.get(sub.scanId);
    if (!p) {
      p = {
        symbols: new Set(),
        timer: setTimeout(() => this.flushLive(sub.scanId), this.debounceMs),
      };
      this.pending.set(sub.scanId, p);
    }
    p.symbols.add(sub.symbolId);
  }

  private flushLive(scanId: string): void {
    const p = this.pending.get(scanId);
    this.pending.delete(scanId);
    const r = this.savedRow(scanId);
    if (!p || !r || r.schedule !== 'intraday' || this.closed) return;
    const key = savedKey(scanId);
    this.enqueue(this.load(key) ?? this.freshSnap(r), r.userId, key, {
      symbols: [...p.symbols],
      trigger: 'intraday',
      replace: false,
    });
  }

  /** Espera a fila esvaziar (testes). */
  async idle(timeoutMs = 60_000): Promise<void> {
    const t0 = Date.now();
    while ((this.busy || this.queue.length || this.pending.size) && Date.now() - t0 < timeoutMs)
      await sleep(20);
  }

  close(): void {
    this.closed = true;
    this.stopSync();
    if (this.timer) clearInterval(this.timer);
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    for (const s of this.subs.values()) s.off();
    this.subs.clear();
  }
}
