import { randomUUID } from 'node:crypto';
import {
  AlertRuntime,
  setupParamsSchema,
  type AlertHit,
  type DrawingGeometry,
  type RuntimeAlert,
} from '@radar/core';
import {
  TIMEFRAME_LABEL,
  alertInputSchema,
  drawingDataSchema,
  formatDateTime,
  formatSessionDate,
  isIntraday,
  prefsSchema,
  type Alert,
  type AlertFire,
  type AlertInput,
  type Candle,
  type FeedStatus,
  type ServerMessage,
  type Timeframe,
} from '@radar/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import { alertFires, alerts, drawings, preferences } from '../db/schema';
import type { MarketHub } from '../market/hub';
import type { MarketService } from '../market/service';
import type { Notifier } from '../notify/notifier';
import type { SyncHub } from '../sync';

/** Tempo com a fonte em erro até disparar o alerta de sistema "fonte caiu". */
export const SOURCE_DOWN_MS = 3 * 60_000;

interface Group {
  key: string;
  userId: number;
  symbolId: string;
  tf: Timeframe;
  runtime: AlertRuntime | null;
  alerts: Map<string, Alert>;
  unsubscribe: (() => void) | null;
  buffer: { candle: Candle; closed: boolean }[];
  ready: boolean;
  label: string;
  errorSince: number | null;
  disposed: boolean;
}

function rowToAlert(r: typeof alerts.$inferSelect): Alert | null {
  const parsed = alertInputSchema.safeParse(JSON.parse(r.json));
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    enabled: r.enabled,
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastFiredAt: r.lastFiredAt,
    status: r.status,
  };
}

/**
 * Avaliação de alertas no servidor, 24 h (SPEC §10). Uma assinatura de tempo real por (usuário,
 * ativo, escala) com alertas ligados; a lógica é a de `@radar/core` (a mesma do navegador).
 */
export class AlertService {
  private readonly groups = new Map<string, Group>();
  private readonly stopSync: () => void;
  private reloading = new Map<number, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly market: MarketService,
    private readonly hub: MarketHub,
    private readonly notifier: Notifier,
    private readonly sync: SyncHub,
    private readonly publicUrl: string,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {
    this.stopSync = sync.onChange((userId, msg) => {
      // desenho mudou ou parâmetros dos setups mudaram: reavalia os alertas do usuário
      if (msg.topic === 'drawings' || msg.topic === 'prefs') void this.reloadUser(userId);
    });
  }

  // ---------------------------------------------------------------- CRUD

  list(userId: number): Alert[] {
    return this.db
      .select()
      .from(alerts)
      .where(eq(alerts.userId, userId))
      .orderBy(desc(alerts.createdAt))
      .all()
      .map(rowToAlert)
      .filter((a): a is Alert => a !== null);
  }

  get(userId: number, id: string): Alert | null {
    const r = this.db
      .select()
      .from(alerts)
      .where(and(eq(alerts.userId, userId), eq(alerts.id, id)))
      .get();
    return r ? rowToAlert(r) : null;
  }

  async create(userId: number, input: AlertInput): Promise<Alert> {
    const id = randomUUID();
    const t = this.now();
    this.db
      .insert(alerts)
      .values({
        id,
        userId,
        symbolId: input.symbolId,
        tf: input.tf,
        json: JSON.stringify(input),
        enabled: input.enabled,
        createdAt: t,
        updatedAt: t,
      })
      .run();
    await this.reloadUser(userId);
    return this.get(userId, id)!;
  }

  async update(userId: number, id: string, input: AlertInput): Promise<Alert | null> {
    const r = this.db
      .update(alerts)
      .set({
        symbolId: input.symbolId,
        tf: input.tf,
        json: JSON.stringify(input),
        enabled: input.enabled,
        updatedAt: this.now(),
        status: null,
      })
      .where(and(eq(alerts.userId, userId), eq(alerts.id, id)))
      .run();
    if (r.changes === 0) return null;
    await this.reloadUser(userId);
    return this.get(userId, id);
  }

  async remove(userId: number, id: string): Promise<boolean> {
    const r = this.db
      .delete(alerts)
      .where(and(eq(alerts.userId, userId), eq(alerts.id, id)))
      .run();
    if (r.changes > 0) await this.reloadUser(userId);
    return r.changes > 0;
  }

  history(userId: number, limit = 100): AlertFire[] {
    return this.db
      .select()
      .from(alertFires)
      .where(eq(alertFires.userId, userId))
      .orderBy(desc(alertFires.firedAt))
      .limit(limit)
      .all()
      .map((r) => ({
        id: r.id,
        alertId: r.alertId,
        symbolId: r.symbolId,
        tf: r.tf,
        firedAt: r.firedAt,
        candleTime: r.candleTime,
        title: r.title,
        body: r.body,
        url: r.url,
        delivery: JSON.parse(r.delivery) as AlertFire['delivery'],
        silenced: r.silenced,
      }));
  }

  // ---------------------------------------------------------------- execução

  /** Liga a avaliação de todos os usuários (chamado na partida do servidor). */
  async start(): Promise<void> {
    const users = new Set(
      this.db
        .select({ userId: alerts.userId })
        .from(alerts)
        .where(eq(alerts.enabled, true))
        .all()
        .map((r) => r.userId),
    );
    await Promise.all([...users].map((u) => this.reloadUser(u)));
  }

  /** Quantas séries estão sendo acompanhadas (diagnóstico e testes). */
  get activeSeries(): string[] {
    return [...this.groups.keys()];
  }

  reloadUser(userId: number): Promise<void> {
    // recargas seguidas do mesmo usuário são encadeadas, nunca simultâneas
    const prev = this.reloading.get(userId) ?? Promise.resolve();
    const next = prev
      .then(() => this.doReload(userId))
      .catch((err) => {
        this.log.error({ err, userId }, 'falha ao recarregar alertas');
      });
    this.reloading.set(userId, next);
    return next;
  }

  private async doReload(userId: number): Promise<void> {
    for (const [k, g] of this.groups) {
      if (g.userId === userId) this.dispose(g, k);
    }
    const enabled = this.list(userId).filter((a) => a.enabled);
    const byKey = new Map<string, Alert[]>();
    for (const a of enabled) {
      const k = `${userId}|${a.symbolId}|${a.tf}`;
      byKey.set(k, [...(byKey.get(k) ?? []), a]);
    }
    await Promise.all([...byKey.entries()].map(([k, list]) => this.startGroup(k, userId, list)));
  }

  private setupParams(userId: number) {
    const row = this.db.select().from(preferences).where(eq(preferences.userId, userId)).get();
    const prefs = row ? prefsSchema.safeParse(JSON.parse(row.json)) : null;
    const raw = prefs?.success ? (prefs.data.setupParams ?? {}) : {};
    const parsed = setupParamsSchema.safeParse(raw);
    return parsed.success ? parsed.data : setupParamsSchema.parse({});
  }

  private drawingGeometry(userId: number, id: string): DrawingGeometry | string {
    const r = this.db
      .select()
      .from(drawings)
      .where(and(eq(drawings.userId, userId), eq(drawings.id, id), isNull(drawings.deletedAt)))
      .get();
    if (!r) return 'o desenho foi apagado';
    const parsed = drawingDataSchema.safeParse((JSON.parse(r.json) as { data?: unknown }).data);
    if (!parsed.success) return 'desenho ilegível';
    const d = parsed.data;
    if (d.kind === 'hline' || d.kind === 'trend' || d.kind === 'ray' || d.kind === 'zone') {
      return { kind: d.kind, points: d.points };
    }
    return 'este tipo de desenho não gera alerta';
  }

  private setStatus(id: string, status: string | null): void {
    this.db.update(alerts).set({ status }).where(eq(alerts.id, id)).run();
  }

  private async startGroup(key: string, userId: number, list: Alert[]): Promise<void> {
    const first = list[0]!;
    const g: Group = {
      key,
      userId,
      symbolId: first.symbolId,
      tf: first.tf,
      runtime: null,
      alerts: new Map(list.map((a) => [a.id, a])),
      unsubscribe: null,
      buffer: [],
      ready: false,
      label: first.symbolId.split(':')[1] ?? first.symbolId,
      errorSince: null,
      disposed: false,
    };
    this.groups.set(key, g);
    // assina antes de aquecer e guarda o que chegar no meio do caminho
    g.unsubscribe = this.hub.subscribe(g.symbolId, g.tf, (m) => this.onMessage(g, m));
    try {
      const meta = await this.market.getMeta(g.symbolId);
      g.label = meta.symbol;
      const hist = await this.market.getCandles(g.symbolId, g.tf, 1500);
      if (g.disposed) return;
      const runtime = new AlertRuntime({
        tf: g.tf,
        tz: meta.session.timezone,
        tick: meta.tickSize,
        decimals: meta.priceDecimals,
        setupParams: this.setupParams(userId),
      });
      runtime.warmup(hist.candles, hist.lastCandleOpen);
      for (const a of list) {
        const ra: RuntimeAlert = { id: a.id, condition: a.condition, trigger: a.trigger };
        if (a.condition.kind === 'drawing') {
          const geo = this.drawingGeometry(userId, a.condition.drawingId);
          if (typeof geo === 'string') {
            this.setStatus(a.id, geo);
            continue;
          }
          ra.drawing = geo;
        }
        if (a.status) this.setStatus(a.id, null);
        runtime.add(ra);
      }
      g.runtime = runtime;
      g.ready = true;
      for (const u of g.buffer.splice(0)) this.process(g, u.candle, u.closed);
    } catch (err) {
      this.log.warn({ err, key }, 'alertas: falha ao carregar o histórico');
      for (const a of list) this.setStatus(a.id, `sem dados: ${(err as Error).message}`);
    }
  }

  private dispose(g: Group, key: string): void {
    g.disposed = true;
    g.unsubscribe?.();
    this.groups.delete(key);
  }

  private onMessage(g: Group, m: ServerMessage): void {
    if (m.type === 'status') return this.onStatus(g, m.status);
    if (m.type !== 'candle') return;
    if (!g.ready) {
      g.buffer.push({ candle: m.candle, closed: m.closed });
      if (g.buffer.length > 5000) g.buffer.shift();
      return;
    }
    this.process(g, m.candle, m.closed);
  }

  private process(g: Group, candle: Candle, closed: boolean): void {
    if (!g.runtime) return;
    let hits: AlertHit[];
    try {
      hits = g.runtime.update(candle, closed);
    } catch (err) {
      this.log.error({ err, key: g.key }, 'alertas: erro ao avaliar');
      return;
    }
    for (const h of hits) void this.fire(g, h);
  }

  private onStatus(g: Group, s: FeedStatus): void {
    const system = [...g.alerts.values()].filter((a) => a.condition.kind === 'system');
    if (s.state !== 'error') {
      g.errorSince = null;
      return;
    }
    const t = this.now();
    g.errorSince ??= t;
    if (system.length === 0) return;
    // checa de novo depois do prazo: se continuar em erro, dispara uma vez por queda
    const since = g.errorSince;
    setTimeout(() => {
      if (g.disposed || g.errorSince !== since) return;
      for (const a of system) {
        void this.fire(g, {
          alertId: a.id,
          candleTime: since,
          price: Number.NaN,
          text: `A fonte de dados está com erro há mais de ${Math.round(SOURCE_DOWN_MS / 60_000)} min: ${s.message ?? 'sem detalhe'}. Os outros alertas deste ativo ficam parados até ela voltar.`,
          dedup: `down:${since}`,
        });
      }
    }, SOURCE_DOWN_MS).unref?.();
  }

  private chartUrl(symbolId: string, tf: string): string {
    const base = this.publicUrl.replace(/\/$/, '');
    return `${base}/grafico?id=${encodeURIComponent(symbolId)}&tf=${tf}`;
  }

  /** Dispara (com anti-duplicação, intervalo mínimo e "uma vez só") e entrega nos canais. */
  async fire(g: Group, h: AlertHit): Promise<void> {
    const a = g.alerts.get(h.alertId);
    if (!a || !a.enabled) return;
    const t = this.now();
    if (a.repeat === 'every' && a.lastFiredAt && t - a.lastFiredAt < a.cooldownMin * 60_000) {
      return;
    }
    const when = isIntraday(g.tf) ? formatDateTime(h.candleTime) : formatSessionDate(h.candleTime);
    const title = `${g.label} · ${TIMEFRAME_LABEL[g.tf]}`;
    const body = `${h.text} (candle de ${when})${a.note ? ` — ${a.note}` : ''}`;
    const url = this.chartUrl(g.symbolId, g.tf);
    const id = randomUUID();
    const inserted = this.db
      .insert(alertFires)
      .values({
        id,
        userId: g.userId,
        alertId: a.id,
        dedupKey: `${a.id}:${h.dedup}`,
        symbolId: g.symbolId,
        tf: g.tf,
        firedAt: t,
        candleTime: h.candleTime,
        title,
        body,
        url,
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 0) return; // já disparou por este mesmo evento
    a.lastFiredAt = t;
    if (a.repeat === 'once') {
      a.enabled = false;
      g.runtime?.remove(a.id);
    }
    this.db
      .update(alerts)
      .set({ lastFiredAt: t, ...(a.repeat === 'once' ? { enabled: false } : {}) })
      .where(eq(alerts.id, a.id))
      .run();
    const { delivery, silenced } = await this.notifier.deliver(
      g.userId,
      { title, body, url, tag: a.id },
      a.channels,
    );
    this.db
      .update(alertFires)
      .set({ delivery: JSON.stringify(delivery), silenced })
      .where(eq(alertFires.id, id))
      .run();
    this.sync.notify(g.userId, { type: 'sync', topic: 'alerts' });
  }

  close(): void {
    this.stopSync();
    for (const [k, g] of this.groups) this.dispose(g, k);
  }
}
