import { randomUUID } from 'node:crypto';
import {
  DEFAULT_COSTS,
  PriceTracker,
  apurarB3,
  costModelSchema,
  exitHit,
  feedbackCandleLimit,
  marketFill,
  marketState,
  orderFill,
  tradeFeedback,
  type CostModel,
  type FeedbackExitKind,
  type Fill,
  type Interval,
  type OrderSide,
  type OrderType,
  type TaxMonth,
  type TaxTrade,
} from '@radar/core';
import {
  TIMEFRAME_LABEL,
  formatBRL,
  formatDateTime,
  formatNumber,
  isIntraday,
  planMissing,
  timeframeSchema,
  type Candle,
  type Market,
  type PaperAccount,
  type PaperAccountInput,
  type PaperAccountUpdate,
  type PaperEvent,
  type PaperEventKind,
  type PaperOrder,
  type PaperOrderInput,
  type PaperPosition,
  type PaperPositionUpdate,
  type PaperStats,
  type ServerMessage,
  type SymbolMeta,
  type Timeframe,
} from '@radar/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import { paperAccounts, paperEvents, paperOrders, paperPositions, tradePlans } from '../db/schema';
import type { MarketHub } from '../market/hub';
import type { MarketService } from '../market/service';
import { readPrefs, userSetupParams } from '../prefs';
import type { SyncHub } from '../sync';

export class PaperError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type AccountRow = typeof paperAccounts.$inferSelect;
type OrderRow = typeof paperOrders.$inferSelect;
type PositionRow = typeof paperPositions.$inferSelect;

interface Watcher {
  symbolId: string;
  tf: Timeframe;
  meta: SymbolMeta;
  tracker: PriceTracker;
  seeded: boolean;
  lastAt: number;
  unsubscribe: () => void;
}

/** Cotação do dólar ao vivo: USDT/BRL da Binance (aproximação do dólar; ADR-0014). */
export const FX_SYMBOL = 'binance:USDTBRL';

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Começo do texto do evento de saída: diz como o trade terminou (anti-revanche e feedback). */
const EXIT_DETAIL = {
  stop: 'Stop executado',
  alvo: 'Alvo executado',
  manual: 'Venda',
  reinicio: 'Encerrada pelo último preço no reinício da conta',
} as const;

function exitKindOf(detail: string): FeedbackExitKind {
  if (detail.startsWith(EXIT_DETAIL.stop)) return 'stop';
  if (detail.startsWith(EXIT_DETAIL.alvo)) return 'alvo';
  if (detail.startsWith(EXIT_DETAIL.reinicio)) return 'reinicio';
  return 'manual';
}

function saoPauloDate(t: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(t));
}

/**
 * Modo Treino ao vivo (SPEC §13): contas com dinheiro fictício, ordens executadas pelo servidor com
 * preços REAIS da fonte (mesmo com o app fechado), usando a lógica de `@radar/core/paper`.
 * Só posições compradas nesta versão: venda a descoberto exige aluguel/margem, que não simulamos ainda.
 */
export class PaperService {
  private readonly watchers = new Map<string, Watcher>();
  private readonly starting = new Map<string, Promise<Watcher | null>>();
  private fx: { rate: number; at: number } | null = null;

  constructor(
    private readonly db: Db,
    private readonly market: MarketService,
    private readonly hub: MarketHub,
    private readonly sync: SyncHub,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
    /** Avisa o usuário de execuções feitas pelo servidor (app fechado): push/Telegram. */
    private readonly tell: (
      userId: number,
      title: string,
      body: string,
      symbolId: string,
    ) => Promise<void> = async () => undefined,
  ) {}

  // ---------------------------------------------------------------- contas

  private toAccount(r: AccountRow): PaperAccount {
    return {
      id: r.id,
      name: r.name,
      initialBalance: r.initialBalance,
      cash: round(r.cash),
      createdAt: r.createdAt,
      resetAt: r.resetAt,
      generation: r.generation,
      costs: JSON.parse(r.costs) as PaperAccount['costs'],
      fxManual: r.fxManual,
    };
  }

  private accountRow(userId: number, id: string): AccountRow {
    const r = this.db
      .select()
      .from(paperAccounts)
      .where(and(eq(paperAccounts.userId, userId), eq(paperAccounts.id, id)))
      .get();
    if (!r) throw new PaperError('conta de treino não encontrada', 404);
    return r;
  }

  listAccounts(userId: number): PaperAccount[] {
    return this.db
      .select()
      .from(paperAccounts)
      .where(eq(paperAccounts.userId, userId))
      .orderBy(asc(paperAccounts.createdAt))
      .all()
      .map((r) => this.toAccount(r));
  }

  createAccount(userId: number, input: PaperAccountInput): PaperAccount {
    if (this.listAccounts(userId).length >= 20)
      throw new PaperError('limite de 20 contas de treino');
    const id = randomUUID();
    this.db
      .insert(paperAccounts)
      .values({
        id,
        userId,
        name: input.name,
        initialBalance: input.initialBalance,
        cash: input.initialBalance,
        createdAt: this.now(),
      })
      .run();
    return this.toAccount(this.accountRow(userId, id));
  }

  updateAccount(userId: number, id: string, u: PaperAccountUpdate): PaperAccount {
    this.accountRow(userId, id);
    this.db
      .update(paperAccounts)
      .set({
        ...(u.name !== undefined ? { name: u.name } : {}),
        ...(u.costs !== undefined ? { costs: JSON.stringify(u.costs ?? {}) } : {}),
        ...(u.fxManual !== undefined ? { fxManual: u.fxManual } : {}),
      })
      .where(eq(paperAccounts.id, id))
      .run();
    return this.toAccount(this.accountRow(userId, id));
  }

  /**
   * Reinicia com um novo saldo. O histórico continua: ordens pendentes são canceladas e posições
   * abertas são encerradas pelo último preço (marcado como "reinício").
   */
  async resetAccount(userId: number, id: string, initialBalance: number): Promise<PaperAccount> {
    const acc = this.accountRow(userId, id);
    const t = this.now();
    const pending = this.db
      .select()
      .from(paperOrders)
      .where(and(eq(paperOrders.accountId, id), eq(paperOrders.status, 'pending')))
      .all();
    for (const o of pending) {
      this.db
        .update(paperOrders)
        .set({ status: 'cancelled', reason: 'conta reiniciada' })
        .where(eq(paperOrders.id, o.id))
        .run();
    }
    const open = this.openPositions(id);
    for (const p of open) {
      const last = await this.lastPrice(p.symbolId).catch(() => null);
      const price = last ?? p.avgPrice;
      const fx = p.currency === 'BRL' ? 1 : ((await this.fxRate(acc).catch(() => p.entryFx)) ?? 1);
      const proceeds = price * p.qty * p.pointValue * fx;
      const pnl = proceeds - p.costBrl;
      this.db
        .update(paperPositions)
        .set({
          qty: 0,
          status: 'closed',
          closedAt: t,
          realizedBrl: p.realizedBrl + pnl,
          salesBrl: p.salesBrl + proceeds,
          costBrl: 0,
        })
        .where(eq(paperPositions.id, p.id))
        .run();
      this.event(id, 'saida', {
        symbolId: p.symbolId,
        positionId: p.id,
        price,
        qty: p.qty,
        pnlBrl: pnl,
        fx,
        detail: `${EXIT_DETAIL.reinicio} (sem custos).`,
      });
    }
    this.db
      .update(paperAccounts)
      .set({
        cash: initialBalance,
        initialBalance,
        generation: acc.generation + 1,
        resetAt: t,
      })
      .where(eq(paperAccounts.id, id))
      .run();
    this.event(id, 'reinicio', {
      detail: `Novo saldo: ${formatBRL(initialBalance)}. O histórico anterior continua salvo.`,
    });
    this.releaseUnused();
    this.changed(userId);
    return this.toAccount(this.accountRow(userId, id));
  }

  // ---------------------------------------------------------------- consultas

  private openPositions(accountId: string): PositionRow[] {
    return this.db
      .select()
      .from(paperPositions)
      .where(and(eq(paperPositions.accountId, accountId), eq(paperPositions.status, 'open')))
      .all();
  }

  private toPosition(p: PositionRow, last: number | null, fxNow: number | null): PaperPosition {
    const unreal =
      p.status === 'open' && last !== null
        ? last * p.qty * p.pointValue * (p.currency === 'BRL' ? 1 : (fxNow ?? p.entryFx)) -
          p.costBrl
        : null;
    const risk =
      p.initialStop !== null
        ? (p.avgPrice - p.initialStop) * p.maxQty * p.pointValue * p.entryFx
        : null;
    return {
      id: p.id,
      accountId: p.accountId,
      symbolId: p.symbolId,
      qty: p.qty,
      avgPrice: p.avgPrice,
      currency: p.currency,
      stop: p.stop,
      target: p.target,
      initialStop: p.initialStop,
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      status: p.status as PaperPosition['status'],
      realizedBrl: round(p.realizedBrl),
      feesBrl: round(p.feesBrl),
      r: p.status === 'closed' && risk && risk > 0 ? round(p.realizedBrl / risk, 2) : null,
      lastPrice: last,
      unrealizedBrl: unreal === null ? null : round(unreal),
      entryFx: p.entryFx,
      delayNote: p.delayNote,
      generation: p.generation,
      plan: this.planOf(p.id),
    };
  }

  private planOf(positionId: string): PaperPosition['plan'] {
    const r = this.db
      .select()
      .from(tradePlans)
      .where(eq(tradePlans.positionId, positionId))
      .orderBy(asc(tradePlans.createdAt))
      .get();
    if (!r) return null;
    return {
      ...(JSON.parse(r.json) as Omit<
        NonNullable<PaperPosition['plan']>,
        'released' | 'hasScreenshot'
      >),
      released: r.released,
      hasScreenshot: Boolean(r.screenshot),
    };
  }

  /** Print do gráfico guardado no plano da posição. */
  planScreenshot(userId: number, positionId: string): string | null {
    const r = this.db
      .select()
      .from(tradePlans)
      .where(and(eq(tradePlans.positionId, positionId), eq(tradePlans.userId, userId)))
      .get();
    return r?.screenshot ?? null;
  }

  /** Stops executados hoje e na semana (anti-revanche, SPEC §11). */
  private stopCounts(accountId: string): { today: number; week: number } {
    const t = this.now();
    const weekAgo = t - 7 * 86_400_000;
    const today = saoPauloDate(t);
    const stops = this.db
      .select()
      .from(paperEvents)
      .where(and(eq(paperEvents.accountId, accountId), eq(paperEvents.kind, 'saida')))
      .all()
      .filter((e) => e.time >= weekAgo && exitKindOf(e.detail) === 'stop');
    return {
      today: stops.filter((e) => saoPauloDate(e.time) === today).length,
      week: stops.length,
    };
  }

  private toOrder(o: OrderRow): PaperOrder {
    return {
      id: o.id,
      accountId: o.accountId,
      symbolId: o.symbolId,
      side: o.side as PaperOrder['side'],
      type: o.type as PaperOrder['type'],
      qty: o.qty,
      price: o.price,
      stopLoss: o.stopLoss,
      takeProfit: o.takeProfit,
      status: o.status as PaperOrder['status'],
      reason: o.reason,
      createdAt: o.createdAt,
      filledAt: o.filledAt,
      fillPrice: o.fillPrice,
      note: o.note,
    };
  }

  async state(userId: number, accountId: string) {
    const acc = this.accountRow(userId, accountId);
    const open = this.openPositions(accountId);
    const fxNow = open.some((p) => p.currency !== 'BRL')
      ? await this.fxRate(acc).catch(() => null)
      : 1;
    const positions: PaperPosition[] = [];
    for (const p of open) {
      const last = await this.lastPrice(p.symbolId).catch(() => null);
      positions.push(this.toPosition(p, last, fxNow));
    }
    const orders = this.db
      .select()
      .from(paperOrders)
      .where(and(eq(paperOrders.accountId, accountId), eq(paperOrders.status, 'pending')))
      .orderBy(desc(paperOrders.createdAt))
      .all()
      .map((o) => this.toOrder(o));
    const events = this.events(accountId, 60);
    // valor de mercado das posições (sem preço: pelo custo)
    const openValue = open.reduce((s, row) => {
      const p = positions.find((x) => x.id === row.id);
      return s + row.costBrl + (p?.unrealizedBrl ?? 0);
    }, 0);
    return {
      account: this.toAccount(acc),
      equity: round(acc.cash + openValue),
      positions,
      orders,
      events,
      fx: fxNow,
      stops: this.stopCounts(accountId),
    };
  }

  events(accountId: string, limit = 100): PaperEvent[] {
    return this.db
      .select()
      .from(paperEvents)
      .where(eq(paperEvents.accountId, accountId))
      .orderBy(desc(paperEvents.time))
      .limit(limit)
      .all()
      .map((e) => ({
        id: e.id,
        time: e.time,
        kind: e.kind as PaperEventKind,
        symbolId: e.symbolId,
        positionId: e.positionId,
        orderId: e.orderId,
        price: e.price,
        qty: e.qty,
        pnlBrl: e.pnlBrl,
        feesBrl: e.feesBrl,
        fx: e.fx,
        detail: e.detail,
      }));
  }

  /** Trades fechados, estatísticas e IR simulado da B3 (geração atual da conta ou todas). */
  journal(userId: number, accountId: string, all = false) {
    const acc = this.accountRow(userId, accountId);
    const closed = this.db
      .select()
      .from(paperPositions)
      .where(and(eq(paperPositions.accountId, accountId), eq(paperPositions.status, 'closed')))
      .orderBy(asc(paperPositions.closedAt))
      .all()
      .filter((p) => all || p.generation === acc.generation);
    const movedBack = this.movedBackIds(accountId);
    const trades = closed.map((p) => ({
      ...this.toPosition(p, null, null),
      riskPct: this.riskPctAtEntry(acc, p, closed),
      stopMovedBack: movedBack.has(p.id),
    }));
    const n = trades.length;
    const wins = trades.filter((t) => t.realizedBrl > 0).length;
    const withR = trades.filter((t) => t.r !== null);
    let peak = acc.initialBalance;
    let equity = acc.initialBalance;
    let ddBrl = 0;
    let ddPct = 0;
    for (const t of trades) {
      equity += t.realizedBrl;
      peak = Math.max(peak, equity);
      ddBrl = Math.max(ddBrl, peak - equity);
      ddPct = Math.max(ddPct, peak > 0 ? (peak - equity) / peak : 0);
    }
    const stats: PaperStats = {
      trades: n,
      wins,
      winRate: n ? wins / n : null,
      avgR: withR.length
        ? round(withR.reduce((s, t) => s + (t.r ?? 0), 0) / withR.length, 2)
        : null,
      expectancyBrl: n ? round(trades.reduce((s, t) => s + t.realizedBrl, 0) / n) : null,
      totalBrl: round(trades.reduce((s, t) => s + t.realizedBrl, 0)),
      feesBrl: round(trades.reduce((s, t) => s + t.feesBrl, 0)),
      maxDrawdownBrl: round(ddBrl),
      maxDrawdownPct: round(ddPct * 100, 2),
      withoutStop: trades.filter((t) => t.initialStop === null).length,
      stopMovedBack: trades.filter((t) => movedBack.has(t.id)).length,
      withPlan: trades.filter((t) => t.plan?.released).length,
      disciplinePct: n
        ? round(
            (trades.filter(
              (t) => t.plan?.released && t.initialStop !== null && !movedBack.has(t.id),
            ).length /
              n) *
              100,
            1,
          )
        : null,
    };
    // IR simulado: só operações da B3 (cripto e EUA têm regras próprias, ainda não simuladas)
    const b3 = closed.filter((p) => p.market === 'b3');
    const sells = b3.length
      ? this.db
          .select()
          .from(paperEvents)
          .where(
            and(
              eq(paperEvents.accountId, accountId),
              eq(paperEvents.kind, 'saida'),
              inArray(
                paperEvents.positionId,
                b3.map((p) => p.id),
              ),
            ),
          )
          .all()
      : [];
    const taxTrades: TaxTrade[] = sells.map((e) => {
      const p = b3.find((x) => x.id === e.positionId)!;
      return {
        time: e.time,
        modality: saoPauloDate(p.openedAt) === saoPauloDate(e.time) ? 'day' : 'swing',
        assetClass: 'acao',
        saleValue: (e.price ?? 0) * (e.qty ?? 0) * p.pointValue,
        result: e.pnlBrl ?? 0,
      };
    });
    const tax: TaxMonth[] = apurarB3(taxTrades);
    return { account: this.toAccount(acc), trades: trades.reverse(), stats, tax };
  }

  /** Posições com "stop movido para trás" registrado no diário. */
  private movedBackIds(accountId: string, positionId?: string): Set<string | null> {
    return new Set(
      this.db
        .select({ positionId: paperEvents.positionId })
        .from(paperEvents)
        .where(
          and(
            eq(paperEvents.accountId, accountId),
            eq(paperEvents.kind, 'stop-movido-para-tras'),
            ...(positionId ? [eq(paperEvents.positionId, positionId)] : []),
          ),
        )
        .all()
        .map((e) => e.positionId),
    );
  }

  /**
   * Risco na entrada em % do patrimônio de trades fechados naquele momento (ADR-0018). Só na geração
   * atual da conta: o saldo inicial de gerações antigas não fica guardado (null = não dá para medir).
   */
  private riskPctAtEntry(
    acc: AccountRow,
    p: PositionRow,
    closed: readonly PositionRow[],
  ): number | null {
    if (p.generation !== acc.generation || p.initialStop === null) return null;
    const before = closed
      .filter(
        (q) => q.generation === acc.generation && q.closedAt !== null && q.closedAt <= p.openedAt,
      )
      .reduce((s, q) => s + q.realizedBrl, 0);
    const equity = acc.initialBalance + before;
    const risk = (p.avgPrice - p.initialStop) * p.maxQty * p.pointValue * p.entryFx;
    return equity > 0 ? round((risk / equity) * 100, 2) : null;
  }

  // ---------------------------------------------------------------- feedback

  /**
   * Feedback depois do trade (SPEC §13): a lógica é a do core (`tradeFeedback`); aqui só juntamos o
   * trade, o plano, as preferências e os candles REAIS da escala do setup. Fonte falhou → os itens que
   * dependem de candles ficam "sem dados" com o motivo.
   */
  async feedback(userId: number, positionId: string) {
    const p = this.db
      .select()
      .from(paperPositions)
      .where(and(eq(paperPositions.id, positionId), eq(paperPositions.userId, userId)))
      .get();
    if (!p) throw new PaperError('trade não encontrado', 404);
    if (p.status !== 'closed' || p.closedAt === null)
      throw new PaperError('o feedback sai quando o trade é encerrado');
    const acc = this.accountRow(userId, p.accountId);
    const plan = this.planOf(p.id);
    const prefs = readPrefs(this.db, userId);
    const events = this.db
      .select()
      .from(paperEvents)
      .where(and(eq(paperEvents.accountId, p.accountId), eq(paperEvents.positionId, p.id)))
      .orderBy(asc(paperEvents.time))
      .all();
    // alvo planejado = o da ordem que abriu a posição (se não havia, o alvo em vigor)
    const entry = events.find((e) => e.kind === 'entrada');
    const entryOrder = entry?.orderId
      ? this.db.select().from(paperOrders).where(eq(paperOrders.id, entry.orderId)).get()
      : undefined;
    const exits = events.filter((e) => e.kind === 'saida');
    const soldQty = exits.reduce((s, e) => s + (e.qty ?? 0), 0);
    const exitPrice =
      soldQty > 0
        ? exits.reduce((s, e) => s + (e.price ?? 0) * (e.qty ?? 0), 0) / soldQty
        : (exits.at(-1)?.price ?? p.avgPrice);
    const closedRows = this.db
      .select()
      .from(paperPositions)
      .where(and(eq(paperPositions.accountId, p.accountId), eq(paperPositions.status, 'closed')))
      .all();

    // escala do setup do plano; sem plano (ou escala inválida), o diário
    const tfParsed = timeframeSchema.safeParse(plan?.tfSetup);
    const tf: Timeframe = tfParsed.success ? tfParsed.data : '1d';
    let meta: SymbolMeta | null = null;
    let candles: Candle[] | null = null;
    let lastOpen = false;
    let candlesError: string | null = null;
    try {
      meta = await this.market.getMeta(p.symbolId);
    } catch (err) {
      candlesError = `fonte indisponível: ${(err as Error).message}`;
    }
    // ativo com atraso: a execução usou o preço de alguns minutos antes (sem look-ahead)
    const delayMs = meta?.delay.kind === 'delayed' ? meta.delay.minutes * 60_000 : 0;
    const openedAt = p.openedAt - delayMs;
    const closedAt = p.closedAt - delayMs;
    if (meta && !meta.timeframes.includes(tf)) {
      candlesError = `a fonte deste ativo não oferece a escala ${TIMEFRAME_LABEL[tf]}`;
    } else if (meta) {
      try {
        const r = await this.market.getCandles(
          p.symbolId,
          tf,
          feedbackCandleLimit(tf, openedAt, this.now()),
        );
        if (r.status.state === 'ok') {
          candles = r.candles;
          lastOpen = r.lastCandleOpen;
        } else {
          const last = r.status.lastValidAt
            ? `; último dado válido em ${formatDateTime(r.status.lastValidAt)}`
            : '';
          candlesError = `fonte indisponível: ${r.status.message ?? r.status.state}${last}`;
        }
      } catch (err) {
        candlesError = `fonte indisponível: ${(err as Error).message}`;
      }
    }
    const fb = tradeFeedback({
      candles,
      candlesError,
      lastOpen,
      tf,
      tz: meta?.session.timezone ?? 'UTC',
      tick: meta?.tickSize ?? p.tick,
      ...(meta ? { decimals: meta.priceDecimals } : {}),
      params: userSetupParams(prefs),
      maxRiskPct: prefs.maxRiskPct,
      plan,
      trade: {
        openedAt,
        closedAt,
        entryPrice: p.avgPrice,
        initialStop: p.initialStop,
        stopAtExit: p.stop,
        target: entryOrder?.takeProfit ?? p.target,
        exitPrice,
        exitKind: exitKindOf(exits.at(-1)?.detail ?? ''),
        r: this.toPosition(p, null, null).r,
        riskPct: this.riskPctAtEntry(acc, p, closedRows),
        stopMovedBack: this.movedBackIds(p.accountId, p.id).has(p.id),
      },
    });
    return {
      ...fb,
      positionId: p.id,
      symbolId: p.symbolId,
      source: meta?.sourceLabel ?? null,
    };
  }

  // ---------------------------------------------------------------- ordens

  private costs(acc: AccountRow, market: Market): CostModel {
    const custom = (JSON.parse(acc.costs) as Record<string, unknown>)[market];
    const parsed = custom ? costModelSchema.safeParse(custom) : null;
    return parsed?.success ? parsed.data : DEFAULT_COSTS[market];
  }

  private async fxRate(acc: AccountRow): Promise<number> {
    const t = this.now();
    if (this.fx && t - this.fx.at < 60_000) return this.fx.rate;
    try {
      const r = await this.market.getCandles(FX_SYMBOL, '1m', 2);
      const last = r.candles.at(-1);
      if (r.status.state === 'ok' && last) {
        this.fx = { rate: last.close, at: t };
        return last.close;
      }
    } catch {
      // cai para a cotação manual
    }
    if (acc.fxManual) return acc.fxManual;
    throw new PaperError(
      'Sem cotação do dólar agora. Informe uma cotação manual na conta de treino para operar ativos em dólar.',
    );
  }

  private async lastPrice(symbolId: string): Promise<number | null> {
    const w = this.watchers.get(symbolId);
    if (w?.tracker.last !== null && w?.tracker.last !== undefined) return w.tracker.last;
    const meta = await this.market.getMeta(symbolId);
    const r = await this.market.getCandles(symbolId, this.tfFor(meta), 2);
    return r.candles.at(-1)?.close ?? null;
  }

  private tfFor(meta: SymbolMeta): Timeframe {
    if (meta.timeframes.includes('1m')) return '1m';
    return meta.timeframes.find((t) => isIntraday(t)) ?? '1d';
  }

  private delayNote(meta: SymbolMeta): string | null {
    if (meta.delay.kind === 'delayed')
      return `Preços com atraso de ~${meta.delay.minutes} min: a execução do treino também usa o preço atrasado.`;
    if (meta.delay.kind === 'eod')
      return 'Fonte só com fechamento do dia: execuções no preço diário.';
    if (meta.delay.kind === 'simulated') return 'DADOS SIMULADOS (desenvolvimento).';
    return null;
  }

  async placeOrder(userId: number, input: PaperOrderInput): Promise<PaperOrder> {
    const acc = this.accountRow(userId, input.accountId);
    const meta = await this.market.getMeta(input.symbolId);
    const qty = input.qty;
    if (meta.qtyStep > 0 && Math.abs(qty / meta.qtyStep - Math.round(qty / meta.qtyStep)) > 1e-6) {
      throw new PaperError(`quantidade precisa ser múltipla de ${meta.qtyStep}`);
    }
    if (qty < meta.minQty) throw new PaperError(`quantidade mínima: ${meta.minQty}`);
    if (input.side === 'buy') {
      if (input.stopLoss !== null) {
        const ref = input.price ?? (await this.lastPrice(input.symbolId)) ?? Infinity;
        if (input.stopLoss >= ref) throw new PaperError('na compra o stop fica ABAIXO da entrada');
      }
      if (
        input.takeProfit !== null &&
        input.stopLoss !== null &&
        input.takeProfit <= input.stopLoss
      )
        throw new PaperError('alvo precisa ficar acima do stop');
    } else {
      const pos = this.openPositions(acc.id).find((p) => p.symbolId === input.symbolId);
      const pendingSells = this.db
        .select()
        .from(paperOrders)
        .where(
          and(
            eq(paperOrders.accountId, acc.id),
            eq(paperOrders.symbolId, input.symbolId),
            eq(paperOrders.side, 'sell'),
            eq(paperOrders.status, 'pending'),
          ),
        )
        .all()
        .reduce((s, o) => s + o.qty, 0);
      if (!pos || pos.qty - pendingSells < qty - 1e-9) {
        throw new PaperError(
          'Venda só para fechar uma posição comprada. Venda a descoberto (vender o que não tem) exige aluguel/margem e ainda não é simulada.',
        );
      }
    }
    if (meta.currency !== 'BRL') await this.fxRate(acc); // falha cedo se não houver cotação
    const t = this.now();
    const id = randomUUID();
    const last = await this.lastPrice(input.symbolId).catch(() => null);
    this.db
      .insert(paperOrders)
      .values({
        id,
        accountId: acc.id,
        userId,
        symbolId: input.symbolId,
        side: input.side,
        type: input.type,
        qty,
        price: input.price,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        status: 'pending',
        note: input.note,
        refPrice: last,
        createdAt: t,
        generation: acc.generation,
      })
      .run();
    this.event(acc.id, 'ordem-criada', {
      symbolId: input.symbolId,
      orderId: id,
      price: input.price,
      qty,
      detail: `${input.side === 'buy' ? 'Compra' : 'Venda'} ${input.type === 'market' ? 'a mercado' : input.type === 'limit' ? 'limitada' : 'stop'}${input.note ? ` — ${input.note}` : ''}`,
    });
    if (input.plan) {
      const { screenshot, ...rest } = input.plan;
      const missing = planMissing(input.plan, {
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        qty,
      });
      this.db
        .insert(tradePlans)
        .values({
          id: randomUUID(),
          userId,
          orderId: id,
          json: JSON.stringify({ ...rest, missing }),
          released: missing.length === 0,
          screenshot,
          createdAt: t,
        })
        .run();
    }
    const w = await this.ensureWatcher(input.symbolId);
    // a mercado com mercado aberto e preço recente: executa já, no último preço + custos
    if (input.type === 'market' && w && last !== null) {
      const open = marketState(meta.session, t) !== 'closed';
      const fresh = t - w.lastAt < 5 * 60_000 || meta.delay.kind !== 'realtime';
      if (open && fresh) {
        const order = this.db.select().from(paperOrders).where(eq(paperOrders.id, id)).get()!;
        const c = this.costs(acc, meta.market);
        await this.execute(
          order,
          marketFill(input.side, last, qty, meta.tickSize, meta.pointValue, c),
          meta,
          null,
        );
      }
    }
    this.changed(userId);
    return this.toOrder(this.db.select().from(paperOrders).where(eq(paperOrders.id, id)).get()!);
  }

  cancelOrder(userId: number, id: string): boolean {
    const o = this.db
      .select()
      .from(paperOrders)
      .where(and(eq(paperOrders.id, id), eq(paperOrders.userId, userId)))
      .get();
    if (!o || o.status !== 'pending') return false;
    this.db
      .update(paperOrders)
      .set({ status: 'cancelled', reason: 'cancelada pelo usuário' })
      .where(eq(paperOrders.id, id))
      .run();
    this.event(o.accountId, 'cancelada', { symbolId: o.symbolId, orderId: id, detail: '' });
    this.releaseUnused();
    this.changed(userId);
    return true;
  }

  /** Move stop/alvo. Stop só anda a favor; afastar exige confirmação e fica no diário (SPEC §11). */
  updatePosition(userId: number, id: string, u: PaperPositionUpdate): PaperPosition {
    const p = this.db
      .select()
      .from(paperPositions)
      .where(and(eq(paperPositions.id, id), eq(paperPositions.userId, userId)))
      .get();
    if (!p || p.status !== 'open') throw new PaperError('posição não encontrada', 404);
    const patch: Partial<PositionRow> = {};
    if (u.stop !== undefined && u.stop !== p.stop) {
      const last = this.watchers.get(p.symbolId)?.tracker.last ?? null;
      if (u.stop !== null && last !== null && u.stop >= last)
        throw new PaperError('o stop de uma compra precisa ficar abaixo do preço atual');
      const backward = u.stop === null || (p.stop !== null && u.stop < p.stop);
      if (backward && !u.confirmBackward) {
        throw new PaperError(
          'Afastar o stop aumenta o risco. Confirme para registrar "stop movido para trás" no diário.',
          409,
        );
      }
      patch.stop = u.stop;
      this.event(p.accountId, backward ? 'stop-movido-para-tras' : 'stop-movido', {
        symbolId: p.symbolId,
        positionId: p.id,
        price: u.stop,
        detail: `de ${p.stop ?? 'sem stop'} para ${u.stop ?? 'sem stop'}`,
      });
    }
    if (u.target !== undefined && u.target !== p.target) {
      patch.target = u.target;
      this.event(p.accountId, 'alvo-movido', {
        symbolId: p.symbolId,
        positionId: p.id,
        price: u.target,
        detail: `de ${p.target ?? 'sem alvo'} para ${u.target ?? 'sem alvo'}`,
      });
    }
    if (Object.keys(patch).length) {
      this.db.update(paperPositions).set(patch).where(eq(paperPositions.id, id)).run();
    }
    this.changed(userId);
    const row = this.db.select().from(paperPositions).where(eq(paperPositions.id, id)).get()!;
    return this.toPosition(row, this.watchers.get(row.symbolId)?.tracker.last ?? null, null);
  }

  // ---------------------------------------------------------------- execução

  /** Aplica uma execução (compra ou venda) e grava tudo numa transação. */
  private async execute(
    o: OrderRow,
    fill: Fill,
    meta: SymbolMeta,
    exitKind: 'stop' | 'alvo' | null,
    positionOverride?: PositionRow,
  ): Promise<string | null> {
    const acc0 = this.db
      .select()
      .from(paperAccounts)
      .where(eq(paperAccounts.id, o.accountId))
      .get();
    if (!acc0) return null;
    const fx = meta.currency === 'BRL' ? 1 : await this.fxRate(acc0).catch(() => null);
    // daqui em diante não há mais await: leitura e escrita do saldo são atômicas
    const acc = this.db.select().from(paperAccounts).where(eq(paperAccounts.id, o.accountId)).get();
    if (!acc) return null;
    const t = this.now();
    if (fx === null) {
      this.reject(o, 'sem cotação do dólar no momento da execução');
      return null;
    }
    const pv = meta.pointValue;
    const feesBrl = fill.fees * fx;
    if (o.side === 'buy') {
      const cost = fill.price * o.qty * pv * fx + feesBrl;
      if (cost > acc.cash + 1e-6) {
        this.reject(o, `saldo insuficiente (precisa de ${formatBRL(cost)})`);
        return null;
      }
      const existing = this.openPositions(acc.id).find((p) => p.symbolId === o.symbolId);
      let posId: string;
      this.db.transaction((tx) => {
        tx.update(paperAccounts)
          .set({ cash: acc.cash - cost })
          .where(eq(paperAccounts.id, acc.id))
          .run();
        if (existing) {
          const qty = existing.qty + o.qty;
          posId = existing.id;
          tx.update(paperPositions)
            .set({
              qty,
              maxQty: Math.max(existing.maxQty, qty),
              avgPrice: (existing.avgPrice * existing.qty + fill.price * o.qty) / qty,
              costBrl: existing.costBrl + cost,
              feesBrl: existing.feesBrl + feesBrl,
              ...(o.stopLoss !== null ? { stop: o.stopLoss } : {}),
              ...(o.takeProfit !== null ? { target: o.takeProfit } : {}),
            })
            .where(eq(paperPositions.id, existing.id))
            .run();
        } else {
          posId = randomUUID();
          tx.insert(paperPositions)
            .values({
              id: posId,
              accountId: acc.id,
              userId: o.userId,
              symbolId: o.symbolId,
              market: meta.market,
              currency: meta.currency,
              pointValue: pv,
              tick: meta.tickSize,
              qty: o.qty,
              maxQty: o.qty,
              avgPrice: fill.price,
              stop: o.stopLoss,
              target: o.takeProfit,
              initialStop: o.stopLoss,
              entryFx: fx,
              costBrl: cost,
              feesBrl,
              status: 'open',
              openedAt: t,
              delayNote: this.delayNote(meta),
              generation: acc.generation,
            })
            .run();
        }
        tx.update(paperOrders)
          .set({ status: 'filled', filledAt: t, fillPrice: fill.price })
          .where(eq(paperOrders.id, o.id))
          .run();
      });
      this.event(acc.id, 'entrada', {
        symbolId: o.symbolId,
        orderId: o.id,
        positionId: posId!,
        price: fill.price,
        qty: o.qty,
        feesBrl,
        fx,
        detail: `${fill.gap ? 'Abriu além do preço (gap): executada na abertura. ' : ''}Derrapagem ${formatNumber(fill.slippage, meta.priceDecimals)} por unidade.`,
      });
      // o plano da ordem passa a ser o plano da posição
      this.db
        .update(tradePlans)
        .set({ positionId: posId! })
        .where(eq(tradePlans.orderId, o.id))
        .run();
      return posId!;
    }
    // venda (fecha parte ou toda a posição comprada)
    const pos =
      positionOverride ?? this.openPositions(acc.id).find((p) => p.symbolId === o.symbolId);
    if (!pos || pos.qty < o.qty - 1e-9) {
      this.reject(o, 'não há posição suficiente para vender');
      return null;
    }
    const proceeds = fill.price * o.qty * pv * fx - feesBrl;
    const basis = pos.costBrl * (o.qty / pos.qty);
    const pnl = proceeds - basis;
    const left = pos.qty - o.qty;
    this.db.transaction((tx) => {
      tx.update(paperAccounts)
        .set({ cash: acc.cash + proceeds })
        .where(eq(paperAccounts.id, acc.id))
        .run();
      tx.update(paperPositions)
        .set({
          qty: left,
          costBrl: pos.costBrl - basis,
          realizedBrl: pos.realizedBrl + pnl,
          feesBrl: pos.feesBrl + feesBrl,
          salesBrl: pos.salesBrl + fill.price * o.qty * pv * fx,
          ...(left <= 1e-9 ? { status: 'closed', closedAt: t, qty: 0 } : {}),
        })
        .where(eq(paperPositions.id, pos.id))
        .run();
      tx.update(paperOrders)
        .set({ status: 'filled', filledAt: t, fillPrice: fill.price })
        .where(eq(paperOrders.id, o.id))
        .run();
      if (left <= 1e-9) {
        // posição zerada: ordens de venda que sobraram não fazem mais sentido
        tx.update(paperOrders)
          .set({ status: 'cancelled', reason: 'posição encerrada' })
          .where(
            and(
              eq(paperOrders.accountId, acc.id),
              eq(paperOrders.symbolId, o.symbolId),
              eq(paperOrders.side, 'sell'),
              eq(paperOrders.status, 'pending'),
            ),
          )
          .run();
      }
    });
    const why = EXIT_DETAIL[exitKind ?? 'manual'];
    this.event(acc.id, 'saida', {
      symbolId: o.symbolId,
      orderId: o.id,
      positionId: pos.id,
      price: fill.price,
      qty: o.qty,
      pnlBrl: pnl,
      feesBrl,
      fx,
      detail: `${why}${fill.gap ? ' (gap: executado na abertura)' : ''}. Resultado ${formatBRL(pnl)} já com custos.`,
    });
    return pos.id;
  }

  private reject(o: OrderRow, reason: string): void {
    this.db
      .update(paperOrders)
      .set({ status: 'rejected', reason })
      .where(eq(paperOrders.id, o.id))
      .run();
    this.event(o.accountId, 'rejeitada', { symbolId: o.symbolId, orderId: o.id, detail: reason });
  }

  private event(
    accountId: string,
    kind: PaperEventKind,
    e: Partial<Omit<PaperEvent, 'id' | 'time' | 'kind'>> & { detail: string },
  ): void {
    this.db
      .insert(paperEvents)
      .values({
        id: randomUUID(),
        accountId,
        time: this.now(),
        kind,
        symbolId: e.symbolId ?? null,
        positionId: e.positionId ?? null,
        orderId: e.orderId ?? null,
        price: e.price ?? null,
        qty: e.qty ?? null,
        pnlBrl: e.pnlBrl === undefined || e.pnlBrl === null ? null : round(e.pnlBrl),
        feesBrl: e.feesBrl === undefined || e.feesBrl === null ? null : round(e.feesBrl),
        fx: e.fx ?? null,
        detail: e.detail,
      })
      .run();
  }

  private changed(userId: number): void {
    this.sync.notify(userId, { type: 'sync', topic: 'paper' });
  }

  /** Processa um intervalo de preço real: ordens pendentes primeiro, depois stops/alvos. */
  private async process(w: Watcher, iv: Interval): Promise<void> {
    const orders = this.db
      .select()
      .from(paperOrders)
      .where(and(eq(paperOrders.symbolId, w.symbolId), eq(paperOrders.status, 'pending')))
      .orderBy(asc(paperOrders.createdAt))
      .all();
    const users = new Set<number>();
    const openedNow = new Set<string>();
    for (const o of orders) {
      const acc = this.db
        .select()
        .from(paperAccounts)
        .where(eq(paperAccounts.id, o.accountId))
        .get();
      if (!acc || o.generation !== acc.generation) continue;
      const fill = orderFill(
        {
          id: o.id,
          side: o.side as OrderSide,
          type: o.type as OrderType,
          qty: o.qty,
          price: o.price,
        },
        iv,
        w.meta.tickSize,
        w.meta.pointValue,
        this.costs(acc, w.meta.market),
      );
      if (!fill) continue;
      const pos = await this.execute(o, fill, w.meta, null);
      if (pos && o.side === 'buy') openedNow.add(pos);
      users.add(o.userId);
      if (pos) {
        void this.tell(
          o.userId,
          `Treino · ${w.meta.symbol}`,
          `Ordem ${o.side === 'buy' ? 'de compra' : 'de venda'} executada a ${formatNumber(fill.price, w.meta.priceDecimals)} (preço real + custos). Dinheiro fictício.`,
          w.symbolId,
        ).catch(() => undefined);
      }
    }
    const positions = this.db
      .select()
      .from(paperPositions)
      .where(and(eq(paperPositions.symbolId, w.symbolId), eq(paperPositions.status, 'open')))
      .all();
    for (const p of positions) {
      if (p.stop === null && p.target === null) continue;
      const acc = this.db
        .select()
        .from(paperAccounts)
        .where(eq(paperAccounts.id, p.accountId))
        .get();
      if (!acc) continue;
      const hit = exitHit(
        { qty: p.qty, avgPrice: p.avgPrice, stop: p.stop, target: p.target },
        iv,
        openedNow.has(p.id),
        w.meta.tickSize,
        w.meta.pointValue,
        this.costs(acc, w.meta.market),
      );
      if (!hit) continue;
      const id = randomUUID();
      this.db
        .insert(paperOrders)
        .values({
          id,
          accountId: p.accountId,
          userId: p.userId,
          symbolId: p.symbolId,
          side: 'sell',
          type: hit.kind === 'stop' ? 'stop' : 'limit',
          qty: p.qty,
          price: hit.kind === 'stop' ? p.stop : p.target,
          status: 'pending',
          note: hit.kind === 'stop' ? 'stop da posição' : 'alvo da posição',
          createdAt: this.now(),
          generation: p.generation,
        })
        .run();
      const order = this.db.select().from(paperOrders).where(eq(paperOrders.id, id)).get()!;
      const done = await this.execute(order, hit, w.meta, hit.kind, p);
      users.add(p.userId);
      if (done) {
        const closed = this.db
          .select()
          .from(paperPositions)
          .where(eq(paperPositions.id, p.id))
          .get();
        const r = closed ? this.toPosition(closed, null, null).r : null;
        void this.tell(
          p.userId,
          `Treino · ${w.meta.symbol}`,
          `${hit.kind === 'stop' ? 'Stop' : 'Alvo'} executado a ${formatNumber(hit.price, w.meta.priceDecimals)}${hit.gap ? ' (gap)' : ''}. Resultado ${formatBRL(closed?.realizedBrl ?? 0)}${r !== null ? ` (${formatNumber(r, 2)}R)` : ''}, já com custos. Dinheiro fictício.`,
          w.symbolId,
        ).catch(() => undefined);
      }
    }
    for (const u of users) this.changed(u);
    if (users.size) this.releaseUnused();
  }

  private onMessage(w: Watcher, m: ServerMessage): void {
    if (m.type !== 'candle') return;
    w.lastAt = this.now();
    if (!w.seeded) {
      w.tracker.seed(m.candle);
      w.seeded = true;
      return;
    }
    const iv = w.tracker.update(m.candle);
    if (iv) {
      void this.process(w, iv).catch((err) =>
        this.log.error({ err, symbolId: w.symbolId }, 'treino: erro ao executar'),
      );
    }
  }

  /** Garante uma assinatura de preço real para o ativo (enquanto houver ordem ou posição). */
  private ensureWatcher(symbolId: string): Promise<Watcher | null> {
    const w = this.watchers.get(symbolId);
    if (w) return Promise.resolve(w);
    const pending = this.starting.get(symbolId);
    if (pending) return pending;
    const p = (async () => {
      try {
        const meta = await this.market.getMeta(symbolId);
        const tf = this.tfFor(meta);
        const watcher: Watcher = {
          symbolId,
          tf,
          meta,
          tracker: new PriceTracker(),
          seeded: false,
          lastAt: 0,
          unsubscribe: () => undefined,
        };
        const hist = await this.market.getCandles(symbolId, tf, 2);
        const last = hist.candles.at(-1);
        if (last) {
          watcher.tracker.seed(last);
          watcher.seeded = true;
          watcher.lastAt = this.now();
        }
        watcher.unsubscribe = this.hub.subscribe(symbolId, tf, (m) => this.onMessage(watcher, m));
        this.watchers.set(symbolId, watcher);
        return watcher;
      } catch (err) {
        this.log.warn({ err, symbolId }, 'treino: sem preço para o ativo');
        return null;
      } finally {
        this.starting.delete(symbolId);
      }
    })();
    this.starting.set(symbolId, p);
    return p;
  }

  /** Para de acompanhar ativos sem ordens pendentes nem posições abertas. */
  private releaseUnused(): void {
    for (const [id, w] of this.watchers) {
      const hasOrder = this.db
        .select({ id: paperOrders.id })
        .from(paperOrders)
        .where(and(eq(paperOrders.symbolId, id), eq(paperOrders.status, 'pending')))
        .get();
      const hasPos = this.db
        .select({ id: paperPositions.id })
        .from(paperPositions)
        .where(and(eq(paperPositions.symbolId, id), eq(paperPositions.status, 'open')))
        .get();
      if (!hasOrder && !hasPos) {
        w.unsubscribe();
        this.watchers.delete(id);
      }
    }
  }

  /** Liga a execução 24 h: acompanha todo ativo com ordem pendente ou posição aberta. */
  async start(): Promise<void> {
    const ids = new Set([
      ...this.db
        .select({ s: paperOrders.symbolId })
        .from(paperOrders)
        .where(eq(paperOrders.status, 'pending'))
        .all()
        .map((r) => r.s),
      ...this.db
        .select({ s: paperPositions.symbolId })
        .from(paperPositions)
        .where(eq(paperPositions.status, 'open'))
        .all()
        .map((r) => r.s),
    ]);
    await Promise.all([...ids].map((id) => this.ensureWatcher(id)));
  }

  /** Para testes e diagnóstico. */
  get watching(): string[] {
    return [...this.watchers.keys()];
  }

  close(): void {
    for (const w of this.watchers.values()) w.unsubscribe();
    this.watchers.clear();
  }
}
