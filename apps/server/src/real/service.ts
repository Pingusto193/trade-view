import { randomUUID } from 'node:crypto';
import {
  RealTradeError,
  apurarB3,
  journalStats,
  realTaxTrades,
  realTrade,
  stopMovedBack,
  type RealFill as CoreFill,
  type TaxMonth,
  type TaxTrade,
} from '@radar/core';
import {
  REAL_MARKETS,
  formatTrim,
  planMissing,
  type PaperEventKind,
  type PaperStats,
  type RealFill,
  type RealFillInput,
  type RealMarket,
  type RealTrade,
  type RealTradeInput,
  type RealTradeUpdate,
  type TradePlan,
} from '@radar/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { realEvents, realFills, realTrades } from '../db/schema';
import type { SyncHub } from '../sync';

export class RealError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type TradeRow = typeof realTrades.$inferSelect;
type FillRow = typeof realFills.$inferSelect;
type EventRow = typeof realEvents.$inferSelect;

/** Tolerância para considerar o stop "no preço médio" (breakeven): metade de um centésimo do preço. */
const BREAKEVEN_TOL = 0.00005;
/** Execução no futuro é erro de digitação (com folga para relógios desalinhados). */
const FUTURE_SLACK_MS = 10 * 60_000;
/** Número em PT-BR sem zeros sobrando ("1.234,5"). */
const num = (x: number) => formatTrim(x);

export interface RealJournal {
  trades: RealTrade[];
  stats: PaperStats;
  /** Estimativa do IR da B3 (ações e futuros); cripto, EUA e forex ficam de fora. */
  tax: TaxMonth[];
}

/** Diário de trades reais (SPEC §13 e §11). */
export class RealJournalService {
  constructor(
    private readonly db: Db,
    private readonly sync: SyncHub,
    private readonly now: () => number = Date.now,
  ) {}

  journal(userId: number): RealJournal {
    const rows = this.db
      .select()
      .from(realTrades)
      .where(eq(realTrades.userId, userId))
      .orderBy(desc(realTrades.createdAt))
      .all();
    const ids = rows.map((r) => r.id);
    const fills = ids.length
      ? this.db
          .select()
          .from(realFills)
          .where(inArray(realFills.tradeId, ids))
          .orderBy(asc(realFills.time))
          .all()
      : [];
    const events = ids.length
      ? this.db
          .select()
          .from(realEvents)
          .where(inArray(realEvents.tradeId, ids))
          .orderBy(asc(realEvents.time))
          .all()
      : [];
    const trades = rows.map((r) =>
      this.toTrade(
        r,
        fills.filter((f) => f.tradeId === r.id),
        events.filter((e) => e.tradeId === r.id),
      ),
    );
    const closed = trades
      .filter((t) => t.status === 'fechado')
      .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
    const stats = journalStats(
      closed.map((t) => ({
        realizedBrl: t.realizedBrl,
        feesBrl: t.feesBrl,
        r: t.r,
        hasStop: t.initialStop !== null,
        stopMovedBack: t.stopMovedBack,
        planReleased: t.plan?.released === true,
      })),
      null,
    );
    // IR: toda saída realiza resultado no mês dela, mesmo com o trade ainda aberto (parcial)
    const taxTrades: TaxTrade[] = [];
    for (const r of rows) {
      const cls = REAL_MARKETS[r.market as RealMarket]?.taxClass ?? null;
      if (!cls) continue;
      const calc = this.calc(
        r,
        fills.filter((f) => f.tradeId === r.id),
      );
      taxTrades.push(...realTaxTrades(calc, cls));
    }
    return { trades, stats, tax: apurarB3(taxTrades) };
  }

  screenshot(userId: number, id: string): string | null {
    return this.row(userId, id).screenshot;
  }

  create(userId: number, input: RealTradeInput): RealTrade {
    this.checkTime(input.entry.time);
    const e = input.entry.price;
    if (input.initialStop !== null && (input.side === 'long') !== input.initialStop < e)
      throw new RealError(
        input.side === 'long'
          ? 'Na compra, o stop fica ABAIXO do preço de entrada.'
          : 'Na venda, o stop fica ACIMA do preço de entrada.',
      );
    if (input.target !== null && (input.side === 'long') !== input.target > e)
      throw new RealError(
        input.side === 'long'
          ? 'Na compra, o alvo fica ACIMA do preço de entrada.'
          : 'Na venda, o alvo fica ABAIXO do preço de entrada.',
      );
    const t = this.now();
    const id = randomUUID();
    const { screenshot, ...plan } = input.plan ?? { screenshot: null };
    this.db.transaction((tx) => {
      tx.insert(realTrades)
        .values({
          id,
          userId,
          symbol: input.symbol.toUpperCase(),
          symbolId: input.symbolId,
          market: input.market,
          side: input.side,
          currency: input.currency.toUpperCase(),
          pointValue: input.pointValue,
          initialStop: input.initialStop,
          stop: input.initialStop,
          target: input.target,
          note: input.note,
          plan: input.plan ? JSON.stringify(plan) : null,
          screenshot: screenshot ?? null,
          createdAt: t,
          updatedAt: t,
        })
        .run();
      tx.insert(realFills)
        .values({ id: randomUUID(), tradeId: id, ...input.entry })
        .run();
      tx.insert(realEvents)
        .values({
          id: randomUUID(),
          tradeId: id,
          time: input.entry.time,
          kind: 'entrada' satisfies PaperEventKind,
          price: input.entry.price,
          detail: `${input.side === 'long' ? 'Compra' : 'Venda'} de ${num(input.entry.qty)}`,
        })
        .run();
    });
    this.changed(userId);
    return this.one(userId, id);
  }

  addFill(userId: number, id: string, fill: RealFillInput): RealTrade {
    this.checkTime(fill.time);
    const row = this.row(userId, id);
    const before = this.fills(id);
    const next = [...before, { ...fill, id: 'novo', tradeId: id }];
    let calc;
    try {
      calc = this.calc(row, next);
    } catch (e) {
      if (e instanceof RealTradeError) throw new RealError(e.message);
      throw e;
    }
    const detail =
      fill.kind === 'entrada'
        ? 'Aumentou a posição'
        : calc.status === 'fechado' && calc.closedAt === fill.time
          ? 'Encerrou o trade'
          : 'Saída parcial';
    this.db.transaction((tx) => {
      tx.insert(realFills)
        .values({ id: randomUUID(), tradeId: id, ...fill })
        .run();
      tx.insert(realEvents)
        .values({
          id: randomUUID(),
          tradeId: id,
          time: fill.time,
          kind: fill.kind === 'entrada' ? 'entrada' : 'saida',
          price: fill.price,
          detail,
        })
        .run();
      tx.update(realTrades).set({ updatedAt: this.now() }).where(eq(realTrades.id, id)).run();
    });
    this.changed(userId);
    return this.one(userId, id);
  }

  /** Apagar uma execução digitada errado. O trade precisa continuar com pelo menos uma entrada. */
  removeFill(userId: number, id: string, fillId: string): RealTrade {
    const row = this.row(userId, id);
    const rest = this.fills(id).filter((f) => f.id !== fillId);
    if (rest.length === this.fills(id).length) throw new RealError('Execução não encontrada.', 404);
    if (!rest.some((f) => f.kind === 'entrada'))
      throw new RealError(
        'O trade precisa de pelo menos uma entrada. Para tirar tudo, apague o trade.',
      );
    try {
      this.calc(row, rest);
    } catch (e) {
      if (e instanceof RealTradeError) throw new RealError(e.message);
      throw e;
    }
    this.db
      .delete(realFills)
      .where(and(eq(realFills.id, fillId), eq(realFills.tradeId, id)))
      .run();
    this.changed(userId);
    return this.one(userId, id);
  }

  update(userId: number, id: string, u: RealTradeUpdate): RealTrade {
    const row = this.row(userId, id);
    const calc = this.calc(row, this.fills(id));
    const t = this.now();
    const evs: Omit<EventRow, 'id' | 'tradeId'>[] = [];
    const set: Partial<TradeRow> = { updatedAt: t };
    if (u.stop !== undefined && u.stop !== row.stop) {
      if (calc.status === 'fechado') throw new RealError('O trade já foi encerrado.');
      const back = stopMovedBack(row.side, row.stop, u.stop);
      if (back && !u.confirmMovedBack)
        throw new RealError(
          'Afastar o stop aumenta o risco. Confirme para registrar "stop movido para trás" no diário.',
          409,
        );
      const be =
        u.stop !== null &&
        calc.avgEntry !== null &&
        Math.abs(u.stop - calc.avgEntry) <= calc.avgEntry * BREAKEVEN_TOL;
      evs.push({
        time: t,
        kind: back ? 'stop-movido-para-tras' : 'stop-movido',
        price: u.stop,
        detail:
          u.stop === null
            ? 'Stop retirado'
            : be
              ? 'Stop no preço de entrada (breakeven)'
              : `Stop de ${row.stop === null ? '—' : num(row.stop)} para ${num(u.stop)}`,
      });
      set.stop = u.stop;
      // trade que entrou sem stop: o primeiro stop vira a referência do R
      if (row.initialStop === null && u.stop !== null) set.initialStop = u.stop;
    }
    if (u.target !== undefined && u.target !== row.target) {
      evs.push({ time: t, kind: 'alvo-movido', price: u.target, detail: 'Alvo alterado' });
      set.target = u.target;
    }
    if (u.note !== undefined) set.note = u.note;
    this.db.transaction((tx) => {
      tx.update(realTrades).set(set).where(eq(realTrades.id, id)).run();
      for (const e of evs)
        tx.insert(realEvents)
          .values({ id: randomUUID(), tradeId: id, ...e })
          .run();
    });
    this.changed(userId);
    return this.one(userId, id);
  }

  remove(userId: number, id: string): void {
    this.row(userId, id);
    this.db.delete(realTrades).where(eq(realTrades.id, id)).run();
    this.changed(userId);
  }

  // ------------------------------------------------------------------ internos

  private changed(userId: number) {
    this.sync.notify(userId, { type: 'sync', topic: 'real' });
  }

  private checkTime(time: number) {
    if (time > this.now() + FUTURE_SLACK_MS)
      throw new RealError('A data da execução está no futuro.');
  }

  private row(userId: number, id: string): TradeRow {
    const r = this.db
      .select()
      .from(realTrades)
      .where(and(eq(realTrades.userId, userId), eq(realTrades.id, id)))
      .get();
    if (!r) throw new RealError('Trade não encontrado.', 404);
    return r;
  }

  private fills(id: string): FillRow[] {
    return this.db
      .select()
      .from(realFills)
      .where(eq(realFills.tradeId, id))
      .orderBy(asc(realFills.time))
      .all();
  }

  private calc(r: TradeRow, fills: readonly Omit<FillRow, 'tradeId'>[]) {
    return realTrade({
      side: r.side,
      pointValue: r.pointValue,
      initialStop: r.initialStop,
      fills: fills.map((f): CoreFill => ({
        time: f.time,
        kind: f.kind,
        qty: f.qty,
        price: f.price,
        feesBrl: f.feesBrl,
        fx: f.fx,
      })),
    });
  }

  private one(userId: number, id: string): RealTrade {
    const r = this.row(userId, id);
    const evs = this.db
      .select()
      .from(realEvents)
      .where(eq(realEvents.tradeId, id))
      .orderBy(asc(realEvents.time))
      .all();
    return this.toTrade(r, this.fills(id), evs);
  }

  private toTrade(r: TradeRow, fills: FillRow[], events: EventRow[]): RealTrade {
    const c = this.calc(r, fills);
    const plan = r.plan ? (JSON.parse(r.plan) as Omit<TradePlan, 'screenshot'>) : null;
    const firstEntry = fills.find((f) => f.kind === 'entrada');
    const missing = plan
      ? planMissing(
          { ...plan, screenshot: r.screenshot },
          { stopLoss: r.initialStop, takeProfit: r.target, qty: firstEntry?.qty ?? null },
        )
      : [];
    return {
      id: r.id,
      symbol: r.symbol,
      symbolId: r.symbolId,
      market: r.market as RealMarket,
      side: r.side,
      currency: r.currency,
      pointValue: r.pointValue,
      initialStop: r.initialStop,
      stop: r.stop,
      target: r.target,
      note: r.note,
      plan: plan ? { ...plan, released: missing.length === 0, missing } : null,
      hasScreenshot: r.screenshot !== null,
      createdAt: r.createdAt,
      status: c.status,
      avgEntry: c.avgEntry,
      openQty: c.openQty,
      maxQty: c.maxQty,
      avgExit: c.avgExit,
      realizedBrl: c.realizedBrl,
      feesBrl: c.feesBrl,
      initialRiskBrl: c.initialRiskBrl,
      r: c.r,
      openedAt: c.openedAt,
      closedAt: c.closedAt,
      stopMovedBack: events.some((e) => e.kind === 'stop-movido-para-tras'),
      fills: fills.map((f): RealFill => ({
        id: f.id,
        time: f.time,
        kind: f.kind,
        qty: f.qty,
        price: f.price,
        feesBrl: f.feesBrl,
        fx: f.fx,
      })),
      events: events.map((e) => ({
        id: e.id,
        time: e.time,
        kind: e.kind as PaperEventKind,
        price: e.price,
        detail: e.detail,
      })),
    };
  }
}
