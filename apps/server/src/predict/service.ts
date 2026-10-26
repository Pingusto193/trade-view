import { createHash } from 'node:crypto';
import {
  BaseRateModel,
  DEFAULT_PREDICT,
  DEFAULT_SETUP_PARAMS,
  FEATURE_NAMES,
  FeatureTracker,
  SituationTracker,
  fitLogistic,
  predictLogistic,
  scorePredictions,
  type LogisticModel,
  type PredictParams,
  type Scoreboard,
  type Situation,
} from '@radar/core';
import {
  INTRADAY_MS,
  isIntraday,
  type Candle,
  type FeedStatus,
  type ServerMessage,
  type Timeframe,
} from '@radar/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import { predictTargets, predictions } from '../db/schema';
import type { MarketHub } from '../market/hub';
import type { MarketService } from '../market/service';
import type { SyncHub } from '../sync';

/** Camada 1 (taxas-base). */
export const PREDICT_METHOD = 'taxa-base';
/** Camada 2 (regressão logística, ADR-0034). */
export const MODEL_METHOD = 'logistica';
/** Candles do histórico para aquecer (o máximo que as fontes costumam devolver). */
const HISTORY = 5000;
/** Fechados guardados em memória para conferir previsões. */
const KEEP = 20_000;
export const MAX_TARGETS_PER_USER = 20;

const DAY = 86_400_000;
function tfMs(tf: Timeframe): number {
  if (isIntraday(tf)) return INTRADAY_MS[tf];
  return tf === '1d' ? DAY : tf === '1w' ? 7 * DAY : 31 * DAY;
}

export interface PredictionRow {
  id: string;
  symbolId: string;
  tf: Timeframe;
  horizon: number;
  method: string;
  candleTime: number;
  createdAt: number;
  close: number;
  p: number;
  alwaysUpP: number;
  persistUp: boolean | null;
  detail: {
    situation: Situation;
    levels: { id: string; n: number; rate: number | null }[];
    /** Só na camada 2: casos de treino e os 5 maiores pesos. */
    n?: number;
    coefficients?: { name: string | undefined; weight: number }[];
  };
  status: 'aberta' | 'conferida' | 'cancelada';
  resolvedAt: number | null;
  targetTime: number | null;
  targetClose: number | null;
  up: boolean | null;
  note: string | null;
}

export interface ScoreboardEntry {
  symbolId: string;
  tf: Timeframe;
  horizon: number;
  method: string;
  open: number;
  cancelled: number;
  board: Scoreboard;
}

export interface TargetStatus {
  symbolId: string;
  tf: Timeframe;
  label: string;
  /** null = acompanhando; texto = motivo de não estar prevendo agora. */
  problem: string | null;
  candles: number;
  lastCandleAt: number | null;
}

interface Group {
  key: string;
  symbolId: string;
  tf: Timeframe;
  label: string;
  tracker: SituationTracker | null;
  models: BaseRateModel[];
  features: FeatureTracker | null;
  /** Vetor de features de cada candle fechado (alinhado com `times`). */
  feats: (number[] | null)[];
  /** Regressão logística por horizonte e quantos candles fechados havia ao ajustar. */
  logistic: Map<number, { model: LogisticModel; at: number; upRate: number }>;
  /** Candles fechados recebidos (não diminui com o corte de memória). */
  count: number;
  times: number[];
  closes: number[];
  forming: Candle | null;
  open: PredictionRow[];
  ready: boolean;
  disposed: boolean;
  buffer: { candle: Candle; closed: boolean }[];
  unsubscribe: (() => void) | null;
  problem: string | null;
}

type Row = typeof predictions.$inferSelect;

function toRow(r: Row): PredictionRow {
  return {
    ...r,
    tf: r.tf as Timeframe,
    detail: JSON.parse(r.detail) as PredictionRow['detail'],
    status: r.status as PredictionRow['status'],
  };
}

/** Índice de `t` em `xs` (crescente) ou -1. */
function indexOf(xs: readonly number[], t: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = xs[mid] as number;
    if (v === t) return mid;
    if (v < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Placar ao vivo (SPEC §23.2, ADR-0033): para cada (ativo, escala) acompanhado, grava uma previsão por
 * horizonte no fechamento de um candle — ANTES do resultado — e confere sozinho quando o candle-alvo
 * fecha. Uma previsão por vez em cada horizonte (sem sobreposição). O banco recusa alterar o que foi
 * previsto (gatilhos da migração 0014).
 */
export class PredictService {
  private readonly groups = new Map<string, Group>();
  private reloading: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly market: MarketService,
    private readonly hub: MarketHub,
    private readonly sync: SyncHub,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
    readonly params: PredictParams = DEFAULT_PREDICT,
  ) {}

  // ------------------------------------------------------------ alvos

  targets(userId: number) {
    return this.db
      .select()
      .from(predictTargets)
      .where(eq(predictTargets.userId, userId))
      .orderBy(asc(predictTargets.createdAt))
      .all()
      .map((r) => ({ symbolId: r.symbolId, tf: r.tf as Timeframe, createdAt: r.createdAt }));
  }

  async addTarget(userId: number, symbolId: string, tf: Timeframe): Promise<void> {
    if (this.targets(userId).length >= MAX_TARGETS_PER_USER)
      throw new Error(`limite de ${MAX_TARGETS_PER_USER} ativos no placar`);
    const meta = await this.market.getMeta(symbolId);
    if (!meta.timeframes.includes(tf)) throw new Error(`a fonte não tem a escala ${tf}`);
    this.db
      .insert(predictTargets)
      .values({ userId, symbolId, tf, createdAt: this.now() })
      .onConflictDoNothing()
      .run();
    await this.reload();
  }

  async removeTarget(userId: number, symbolId: string, tf: Timeframe): Promise<void> {
    this.db
      .delete(predictTargets)
      .where(
        and(
          eq(predictTargets.userId, userId),
          eq(predictTargets.symbolId, symbolId),
          eq(predictTargets.tf, tf),
        ),
      )
      .run();
    await this.reload();
  }

  /** Situação de cada série acompanhada (para a tela do placar). */
  status(): TargetStatus[] {
    return [...this.groups.values()].map((g) => ({
      symbolId: g.symbolId,
      tf: g.tf,
      label: g.label,
      problem: g.problem ?? (g.ready ? null : 'carregando o histórico'),
      candles: g.times.length,
      lastCandleAt: g.times.at(-1) ?? null,
    }));
  }

  // ------------------------------------------------------------ execução

  start(): Promise<void> {
    return this.reload();
  }

  close(): void {
    for (const [k, g] of this.groups) this.dispose(g, k);
  }

  /** Acompanha a união dos alvos de todos os usuários (recargas encadeadas, nunca simultâneas). */
  reload(): Promise<void> {
    this.reloading = this.reloading
      .then(() => this.doReload())
      .catch((err) => this.log.error({ err }, 'placar: falha ao recarregar'));
    return this.reloading;
  }

  private async doReload(): Promise<void> {
    const want = new Map<string, { symbolId: string; tf: Timeframe }>();
    for (const r of this.db.select().from(predictTargets).all())
      want.set(`${r.symbolId}|${r.tf}`, { symbolId: r.symbolId, tf: r.tf as Timeframe });
    for (const [k, g] of this.groups) if (!want.has(k)) this.dispose(g, k);
    await Promise.all(
      [...want.entries()]
        .filter(([k]) => !this.groups.has(k))
        .map(([k, t]) => this.startGroup(k, t.symbolId, t.tf)),
    );
  }

  private dispose(g: Group, key: string): void {
    g.disposed = true;
    g.unsubscribe?.();
    this.groups.delete(key);
  }

  private async startGroup(key: string, symbolId: string, tf: Timeframe): Promise<void> {
    const g: Group = {
      key,
      symbolId,
      tf,
      label: symbolId.split(':')[1] ?? symbolId,
      tracker: null,
      models: [],
      features: null,
      feats: [],
      logistic: new Map(),
      count: 0,
      times: [],
      closes: [],
      forming: null,
      open: [],
      ready: false,
      disposed: false,
      buffer: [],
      unsubscribe: null,
      problem: null,
    };
    this.groups.set(key, g);
    // assina antes de aquecer e guarda o que chegar no meio do caminho
    g.unsubscribe = this.hub.subscribe(symbolId, tf, (m) => this.onMessage(g, m));
    try {
      const meta = await this.market.getMeta(symbolId);
      g.label = meta.symbol;
      const hist = await this.market.getCandles(symbolId, tf, HISTORY);
      if (g.disposed) return;
      const n = hist.candles.length;
      const closed = hist.lastCandleOpen ? hist.candles.slice(0, n - 1) : hist.candles;
      g.forming = hist.lastCandleOpen ? (hist.candles[n - 1] ?? null) : null;
      // a previsão usa os parâmetros PADRÃO dos setups: o placar é um só (ADR-0033)
      g.tracker = new SituationTracker({
        tf,
        tz: meta.session.timezone,
        tick: meta.tickSize,
      });
      g.models = this.params.horizons.map((h) => new BaseRateModel(h, this.params.shrink));
      g.features = new FeatureTracker(DEFAULT_SETUP_PARAMS.pa);
      for (const c of closed) this.feed(g, c);
      g.open = this.db
        .select()
        .from(predictions)
        .where(
          and(
            eq(predictions.symbolId, symbolId),
            eq(predictions.tf, tf),
            eq(predictions.status, 'aberta'),
          ),
        )
        .all()
        .map(toRow);
      this.resolveOpen(g);
      if (hist.status.state === 'error') g.problem = hist.status.message ?? 'fonte com erro';
      g.ready = true;
      for (const u of g.buffer.splice(0)) this.process(g, u.candle, u.closed);
    } catch (err) {
      g.problem = `sem dados: ${(err as Error).message}`;
      this.log.warn({ err, key }, 'placar: falha ao carregar o histórico');
    }
  }

  private onMessage(g: Group, m: ServerMessage): void {
    if (m.type === 'status') {
      this.onStatus(g, m.status);
      return;
    }
    if (m.type !== 'candle') return;
    if (!g.ready) {
      g.buffer.push({ candle: m.candle, closed: m.closed });
      if (g.buffer.length > 5000) g.buffer.shift();
      return;
    }
    this.process(g, m.candle, m.closed);
  }

  private onStatus(g: Group, s: FeedStatus): void {
    if (!g.ready) return;
    g.problem = s.state === 'error' ? (s.message ?? 'fonte com erro') : null;
  }

  /** Alimenta situação e modelos com um candle fechado (sem gravar nada). */
  private feed(g: Group, c: Candle): Situation {
    g.times.push(c.time);
    g.closes.push(c.close);
    const s = g.tracker!.push(c);
    g.feats.push(g.features!.push(c, s, g.tracker!.engine.series));
    g.count++;
    if (g.times.length > KEEP) {
      const cut = g.times.length - KEEP;
      g.times.splice(0, cut);
      g.closes.splice(0, cut);
      g.feats.splice(0, cut);
    }
    for (const m of g.models) m.push(c.close, s);
    return s;
  }

  /**
   * Regressão logística do horizonte, reajustada a cada `refitEvery` candles com todos os rótulos já
   * conhecidos (i + horizonte ≤ último candle fechado). null com casos de treino de menos.
   */
  private logisticFor(g: Group, h: number) {
    const cur = g.logistic.get(h);
    if (cur && g.count - cur.at < this.params.refitEvery) return cur;
    const X: number[][] = [];
    const y: boolean[] = [];
    let up = 0;
    for (let i = 0; i + h < g.closes.length; i++) {
      const x = g.feats[i];
      if (!x) continue;
      const u = (g.closes[i + h] as number) > (g.closes[i] as number);
      X.push(x);
      y.push(u);
      if (u) up++;
    }
    if (X.length < this.params.minTrain) return null;
    const fit = {
      model: fitLogistic(X, y, { l2: this.params.l2 }),
      at: g.count,
      upRate: up / X.length,
    };
    g.logistic.set(h, fit);
    return fit;
  }

  /** Mesma regra do AlertRuntime: candles velhos/repetidos são ignorados; candle novo fecha o anterior. */
  private process(g: Group, candle: Candle, closed: boolean): void {
    if (!g.tracker) return;
    const last = g.times.at(-1);
    if (last !== undefined && candle.time <= last) return;
    try {
      if (g.forming && candle.time > g.forming.time) {
        // fechado por inferência: o candle seguinte JÁ começou (abertura conhecida) → não prevê
        this.closeCandle(g, g.forming, false);
      }
      if (closed) {
        this.closeCandle(g, candle, true);
        g.forming = null;
      } else g.forming = candle;
    } catch (err) {
      this.log.error({ err, key: g.key }, 'placar: erro ao processar candle');
    }
  }

  private closeCandle(g: Group, c: Candle, explicit: boolean): void {
    g.forming = null;
    const situation = this.feed(g, c);
    let changed = this.resolveOpen(g);
    // só grava com o fechamento explícito e enquanto o candle seguinte nem fechou (nada do futuro)
    if (explicit && this.now() <= c.time + 2 * tfMs(g.tf) && g.times.length > this.params.warmup) {
      const n = g.closes.length;
      const persistUp = n > 1 ? c.close > (g.closes[n - 2] as number) : null;
      const isOpen = (h: number, method: string) =>
        g.open.some((p) => p.horizon === h && p.method === method);
      for (const m of g.models) {
        if (!isOpen(m.horizon, PREDICT_METHOD)) {
          const e = m.estimate();
          this.record(g, c, {
            method: PREDICT_METHOD,
            horizon: m.horizon,
            p: e.p,
            alwaysUpP: e.alwaysUpP,
            persistUp: e.persistUp,
            detail: {
              situation,
              levels: [...e.levels, ...e.facets].map((l) => ({ id: l.id, n: l.n, rate: l.rate })),
            },
          });
          changed = true;
        }
        const x = g.feats.at(-1);
        if (!x || isOpen(m.horizon, MODEL_METHOD)) continue;
        const fit = this.logisticFor(g, m.horizon);
        if (!fit) continue;
        this.record(g, c, {
          method: MODEL_METHOD,
          horizon: m.horizon,
          p: predictLogistic(fit.model, x),
          alwaysUpP: fit.upRate,
          persistUp,
          detail: {
            situation,
            levels: [],
            n: fit.model.n,
            coefficients: fit.model.w
              .map((w, j) => ({ name: FEATURE_NAMES[j], weight: w }))
              .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
              .slice(0, 5),
          },
        });
        changed = true;
      }
    }
    if (changed) this.sync.broadcast({ type: 'sync', topic: 'predict', symbolId: g.symbolId });
  }

  private record(
    g: Group,
    c: Candle,
    r: {
      method: string;
      horizon: number;
      p: number;
      alwaysUpP: number;
      persistUp: boolean | null;
      detail: PredictionRow['detail'];
    },
  ): void {
    const id = createHash('sha256')
      .update(`${g.symbolId}|${g.tf}|${r.horizon}|${r.method}|${c.time}`)
      .digest('hex')
      .slice(0, 24);
    const row = {
      id,
      symbolId: g.symbolId,
      tf: g.tf,
      horizon: r.horizon,
      method: r.method,
      candleTime: c.time,
      createdAt: this.now(),
      close: c.close,
      p: r.p,
      alwaysUpP: r.alwaysUpP,
      persistUp: r.persistUp,
      detail: JSON.stringify(r.detail),
    };
    const res = this.db.insert(predictions).values(row).onConflictDoNothing().run();
    if (res.changes === 0) return;
    g.open.push(
      toRow({
        ...row,
        status: 'aberta',
        resolvedAt: null,
        targetTime: null,
        targetClose: null,
        up: null,
        note: null,
      }),
    );
  }

  /** Confere as previsões abertas cujo candle-alvo já fechou. Devolve se mudou algo. */
  private resolveOpen(g: Group): boolean {
    let changed = false;
    const tfLen = tfMs(g.tf);
    for (const p of [...g.open]) {
      const j = indexOf(g.times, p.candleTime);
      let note: string;
      if (j < 0) {
        const first = g.times[0];
        if (first === undefined) continue;
        note =
          p.candleTime < first
            ? 'o histórico da fonte não alcança mais o candle da previsão'
            : 'o candle da previsão sumiu da fonte (buraco nos dados)';
      } else {
        const k = j + p.horizon;
        if (k >= g.times.length) continue;
        const targetTime = g.times[k] as number;
        const targetClose = g.closes[k] as number;
        if (targetTime + tfLen <= p.createdAt) {
          note = 'o resultado já era conhecido quando a previsão foi gravada';
        } else {
          this.db
            .update(predictions)
            .set({
              status: 'conferida',
              resolvedAt: this.now(),
              targetTime,
              targetClose,
              up: targetClose > p.close,
            })
            .where(eq(predictions.id, p.id))
            .run();
          g.open = g.open.filter((x) => x.id !== p.id);
          changed = true;
          continue;
        }
      }
      this.db
        .update(predictions)
        .set({ status: 'cancelada', resolvedAt: this.now(), note })
        .where(eq(predictions.id, p.id))
        .run();
      g.open = g.open.filter((x) => x.id !== p.id);
      changed = true;
    }
    return changed;
  }

  // ------------------------------------------------------------ consultas

  list(q: {
    symbolId?: string;
    tf?: Timeframe;
    horizon?: number;
    limit?: number;
  }): PredictionRow[] {
    const conds = [
      ...(q.symbolId ? [eq(predictions.symbolId, q.symbolId)] : []),
      ...(q.tf ? [eq(predictions.tf, q.tf)] : []),
      ...(q.horizon ? [eq(predictions.horizon, q.horizon)] : []),
    ];
    return this.db
      .select()
      .from(predictions)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(predictions.candleTime), asc(predictions.horizon))
      .limit(Math.min(q.limit ?? 50, 500))
      .all()
      .map(toRow);
  }

  /** Placar por (ativo, escala, horizonte, método), só com previsões conferidas. */
  scoreboard(q: { symbolId?: string; tf?: Timeframe } = {}): ScoreboardEntry[] {
    const conds = [
      ...(q.symbolId ? [eq(predictions.symbolId, q.symbolId)] : []),
      ...(q.tf ? [eq(predictions.tf, q.tf)] : []),
    ];
    const rows = this.db
      .select()
      .from(predictions)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(predictions.candleTime))
      .all();
    const by = new Map<string, Row[]>();
    for (const r of rows) {
      const k = `${r.symbolId}|${r.tf}|${r.horizon}|${r.method}`;
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return [...by.values()].map((list) => {
      const r0 = list[0] as Row;
      const done = list.filter((r) => r.status === 'conferida');
      return {
        symbolId: r0.symbolId,
        tf: r0.tf as Timeframe,
        horizon: r0.horizon,
        method: r0.method,
        open: list.filter((r) => r.status === 'aberta').length,
        cancelled: list.filter((r) => r.status === 'cancelada').length,
        board: scorePredictions(
          done.map((r) => ({
            time: r.candleTime,
            p: r.p,
            alwaysUpP: r.alwaysUpP,
            persistUp: r.persistUp,
            up: r.up as boolean,
          })),
          this.params.minCases,
        ),
      };
    });
  }
}
