import { randomUUID } from 'node:crypto';
import {
  DEFAULT_COSTS,
  ReplayError,
  journalStats,
  newReplayBook,
  replayCancel,
  replayEquity,
  replayFinish,
  replayMove,
  replayOrder,
  replayStep,
  tradeFeedback,
  type ReplayBook,
  type ReplayPlan,
  type ReplayTrade,
  type TradeFeedback,
} from '@radar/core';
import {
  REPLAY_MAX_STEP,
  REPLAY_MIN_AHEAD,
  REPLAY_WARMUP,
  UNIVERSES,
  planMissing,
  type Candle,
  type PaperStats,
  type ReplayCreate,
  type ReplayMoveInput,
  type ReplayOrderInput,
  type SymbolMeta,
  type Timeframe,
} from '@radar/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { replaySessions } from '../db/schema';
import type { MarketService } from '../market/service';
import { FX_SYMBOL } from '../paper/service';
import { readPrefs, userSetupParams } from '../prefs';
import type { SyncHub } from '../sync';

export { ReplayError };

/** Candles pedidos à fonte para montar uma sessão. */
const REPLAY_FETCH = 2000;
/** Ativos tentados no sorteio até achar um com histórico suficiente. */
const DRAW_ATTEMPTS = 6;

type Row = typeof replaySessions.$inferSelect;

export interface ReplayView {
  id: string;
  hidden: boolean;
  status: 'ativa' | 'encerrada';
  tf: Timeframe;
  /** Com a sessão escondida e ativa: "Ativo sorteado" (o código só aparece no fim). */
  symbol: string;
  symbolId: string | null;
  meta: SymbolMeta;
  /** Candles revelados até agora (nunca os do futuro). */
  candles: Candle[];
  cursor: number;
  total: number;
  startIndex: number;
  book: Omit<ReplayBook, 'costs'> & { costs: ReplayBook['costs'] };
  equity: number;
  createdAt: number;
}

export interface ReplaySummary {
  id: string;
  label: string;
  tf: Timeframe;
  status: 'ativa' | 'encerrada';
  trades: number;
  resultBrl: number;
  avgR: number | null;
  createdAt: number;
}

export class ReplayService {
  constructor(
    private readonly db: Db,
    private readonly market: MarketService,
    private readonly sync: SyncHub,
    private readonly simulated: boolean,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  list(userId: number): ReplaySummary[] {
    return this.db
      .select()
      .from(replaySessions)
      .where(eq(replaySessions.userId, userId))
      .orderBy(desc(replaySessions.createdAt))
      .limit(50)
      .all()
      .map((r) => {
        const book = JSON.parse(r.book) as ReplayBook;
        const meta = JSON.parse(r.meta) as SymbolMeta;
        const withR = book.trades.filter((t) => t.r !== null);
        return {
          id: r.id,
          label: r.hidden && r.status === 'ativa' ? 'Ativo sorteado' : meta.symbol,
          tf: r.tf as Timeframe,
          status: r.status,
          trades: book.trades.length,
          resultBrl: Math.round(book.trades.reduce((s, t) => s + t.realizedBrl, 0) * 100) / 100,
          avgR: withR.length
            ? Math.round((withR.reduce((s, t) => s + (t.r ?? 0), 0) / withR.length) * 100) / 100
            : null,
          createdAt: r.createdAt,
        };
      });
  }

  /** Estatísticas de todos os trades de replay (para comparar com o treino ao vivo e o real). */
  journal(userId: number): { stats: PaperStats; trades: number } {
    const trades: ReplayTrade[] = this.db
      .select({ book: replaySessions.book })
      .from(replaySessions)
      .where(eq(replaySessions.userId, userId))
      .all()
      .flatMap((r) => (JSON.parse(r.book) as ReplayBook).trades)
      .sort((a, b) => a.closedAt - b.closedAt);
    const stats = journalStats(
      trades.map((t) => ({
        realizedBrl: t.realizedBrl,
        feesBrl: t.feesBrl,
        r: t.r,
        hasStop: t.initialStop !== null,
        stopMovedBack: t.stopMovedBack,
        planReleased: t.plan?.released === true,
      })),
      null,
    );
    return { stats, trades: trades.length };
  }

  async create(userId: number, input: ReplayCreate): Promise<ReplayView> {
    const picked =
      input.mode === 'sorteio' || !input.symbolId
        ? await this.draw(input.tf, input.date)
        : await this.load(input.symbolId, input.tf, input.date);
    const fx = picked.meta.currency === 'BRL' ? 1 : await this.fx(input.fxManual);
    const t = this.now();
    const id = randomUUID();
    const book = newReplayBook({
      initialBalance: input.capital,
      fx,
      tick: picked.meta.tickSize,
      pointValue: picked.meta.pointValue,
      costs: DEFAULT_COSTS[picked.meta.market],
    });
    this.db
      .insert(replaySessions)
      .values({
        id,
        userId,
        symbolId: picked.meta.id,
        tf: input.tf,
        hidden: input.mode === 'sorteio',
        meta: JSON.stringify(picked.meta),
        candles: JSON.stringify(picked.candles),
        startIndex: picked.start,
        cursor: picked.start,
        book: JSON.stringify(book),
        status: 'ativa',
        createdAt: t,
        updatedAt: t,
      })
      .run();
    this.changed(userId);
    return this.view(userId, id);
  }

  view(userId: number, id: string): ReplayView {
    return this.toView(this.row(userId, id));
  }

  /** Revela `n` candles, executando ordens, stop e alvo em cada um. */
  advance(userId: number, id: string, n: number): ReplayView & { revealed: Candle[] } {
    const r = this.active(userId, id);
    const candles = JSON.parse(r.candles) as Candle[];
    let book = JSON.parse(r.book) as ReplayBook;
    const steps = Math.max(1, Math.min(REPLAY_MAX_STEP, Math.floor(n)));
    let cursor = r.cursor;
    const revealed: Candle[] = [];
    for (let i = 0; i < steps && cursor < candles.length; i++) {
      const c = candles[cursor] as Candle;
      book = replayStep(book, c, randomUUID);
      revealed.push(c);
      cursor++;
    }
    const ended = cursor >= candles.length;
    if (ended) book = replayFinish(book, candles[cursor - 1] as Candle);
    this.save(r.id, { cursor, book, ...(ended ? { status: 'encerrada' as const } : {}) });
    this.changed(userId);
    return { ...this.view(userId, id), revealed };
  }

  order(userId: number, id: string, o: ReplayOrderInput): ReplayView {
    const r = this.active(userId, id);
    const { book, last } = this.state(r);
    const plan: ReplayPlan | null = o.plan
      ? (() => {
          const missing = planMissing(o.plan, {
            stopLoss: o.stop,
            takeProfit: o.target,
            qty: o.qty,
          });
          return {
            setup: o.plan.setup,
            tfSetup: o.plan.tfSetup,
            aligned: o.plan.aligned,
            warnings: o.plan.warnings,
            released: missing.length === 0,
            missing,
          };
        })()
      : null;
    const next = replayOrder(
      book,
      { id: randomUUID(), ...o, placedAt: last.time, plan },
      last.close,
    );
    this.save(r.id, { book: next });
    this.changed(userId);
    return this.view(userId, id);
  }

  cancel(userId: number, id: string, orderId: string): ReplayView {
    const r = this.active(userId, id);
    const { book, last } = this.state(r);
    this.save(r.id, { book: replayCancel(book, orderId, last.time) });
    this.changed(userId);
    return this.view(userId, id);
  }

  move(userId: number, id: string, u: ReplayMoveInput): ReplayView {
    const r = this.active(userId, id);
    const { book, last } = this.state(r);
    this.save(r.id, { book: replayMove(book, u, last.time, last.close) });
    this.changed(userId);
    return this.view(userId, id);
  }

  /** Encerra: vende o que estiver aberto no último fechamento e revela ativo e datas. */
  end(userId: number, id: string): ReplayView {
    const r = this.active(userId, id);
    const { book, last } = this.state(r);
    this.save(r.id, { book: replayFinish(book, last), status: 'encerrada' });
    this.changed(userId);
    return this.view(userId, id);
  }

  remove(userId: number, id: string): void {
    this.row(userId, id);
    this.db.delete(replaySessions).where(eq(replaySessions.id, id)).run();
    this.changed(userId);
  }

  /**
   * Feedback de um trade do replay (SPEC §13), com a mesma lógica do treino ao vivo, usando SÓ os
   * candles já revelados — o feedback nunca mostra o futuro.
   */
  feedback(userId: number, id: string, tradeId: string): TradeFeedback {
    const r = this.row(userId, id);
    const book = JSON.parse(r.book) as ReplayBook;
    const t = book.trades.find((x) => x.id === tradeId);
    if (!t) throw new ReplayError('Trade não encontrado.', 404);
    const meta = JSON.parse(r.meta) as SymbolMeta;
    const candles = (JSON.parse(r.candles) as Candle[]).slice(0, r.cursor);
    const prefs = readPrefs(this.db, userId);
    return tradeFeedback({
      candles,
      tf: r.tf as Timeframe,
      tz: meta.session.timezone,
      tick: meta.tickSize,
      decimals: meta.priceDecimals,
      params: userSetupParams(prefs),
      maxRiskPct: prefs.maxRiskPct,
      trade: {
        openedAt: t.openedAt,
        closedAt: t.closedAt,
        entryPrice: t.avgPrice,
        entryCostPerUnit: t.entryCostPerUnit,
        initialStop: t.initialStop,
        stopAtExit: t.stop,
        target: t.target,
        exitPrice: t.exitPrice,
        exitKind: t.exitKind,
        r: t.r,
        riskPct: t.riskPct,
        stopMovedBack: t.stopMovedBack,
      },
      plan: t.plan,
    });
  }

  // ------------------------------------------------------------------ internos

  private async draw(tf: Timeframe, date?: number) {
    const pool = this.simulated
      ? [...UNIVERSES.sim.symbols]
      : [...UNIVERSES.b3.symbols, ...UNIVERSES.cripto.symbols, ...UNIVERSES.eua.symbols];
    const tried: string[] = [];
    let lastErr = 'nenhum ativo tentado';
    for (let i = 0; i < DRAW_ATTEMPTS && pool.length; i++) {
      const k = Math.floor(this.random() * pool.length);
      const symbolId = pool.splice(k, 1)[0] as string;
      tried.push(symbolId);
      try {
        return await this.load(symbolId, tf, date);
      } catch (e) {
        lastErr = (e as Error).message;
      }
    }
    throw new ReplayError(
      `Não achei histórico suficiente para sortear (${tried.length} ativos tentados). Último motivo: ${lastErr}`,
    );
  }

  private async load(symbolId: string, tf: Timeframe, date?: number) {
    const resp = await this.market.getCandles(symbolId, tf, REPLAY_FETCH);
    if (resp.status.state !== 'ok' && resp.candles.length === 0)
      throw new ReplayError(`Sem dados da fonte agora: ${resp.status.message ?? 'erro'}`);
    // só candles fechados: o último, em formação, nunca entra no replay
    const candles = resp.lastCandleOpen ? resp.candles.slice(0, -1) : resp.candles;
    const min = REPLAY_WARMUP + REPLAY_MIN_AHEAD;
    if (candles.length < min)
      throw new ReplayError(
        `${resp.meta.symbol}: a fonte tem ${candles.length} candles nesta escala; o replay precisa de pelo menos ${min} (${REPLAY_WARMUP} antes do início para os indicadores + ${REPLAY_MIN_AHEAD} depois).`,
      );
    let start: number;
    if (date !== undefined) {
      start = candles.findIndex((c) => c.time >= date);
      if (start < 0 || start > candles.length - REPLAY_MIN_AHEAD)
        throw new ReplayError(
          `Depois dessa data há menos de ${REPLAY_MIN_AHEAD} candles na fonte. Escolha uma data mais antiga.`,
        );
      if (start < REPLAY_WARMUP)
        throw new ReplayError(
          `A fonte só tem ${start} candles antes dessa data; o replay precisa de ${REPLAY_WARMUP} para os indicadores. Escolha uma data mais recente.`,
        );
    } else {
      const lo = REPLAY_WARMUP;
      const hi = candles.length - REPLAY_MIN_AHEAD;
      start = lo + Math.floor(this.random() * (hi - lo + 1));
    }
    // aquecimento + o resto: o que vem depois do início fica no servidor até ser revelado
    const from = start - REPLAY_WARMUP;
    return { meta: resp.meta, candles: candles.slice(from), start: REPLAY_WARMUP };
  }

  private async fx(manual?: number): Promise<number> {
    try {
      const r = await this.market.getCandles(FX_SYMBOL, '1m', 2);
      const last = r.candles.at(-1);
      if (r.status.state === 'ok' && last) return last.close;
    } catch {
      // cai para a cotação manual
    }
    if (manual) return manual;
    throw new ReplayError(
      'Sem cotação do dólar agora. Informe o câmbio manual para fazer replay de um ativo em dólar.',
    );
  }

  private row(userId: number, id: string): Row {
    const r = this.db
      .select()
      .from(replaySessions)
      .where(and(eq(replaySessions.userId, userId), eq(replaySessions.id, id)))
      .get();
    if (!r) throw new ReplayError('Sessão de replay não encontrada.', 404);
    return r;
  }

  private active(userId: number, id: string): Row {
    const r = this.row(userId, id);
    if (r.status !== 'ativa') throw new ReplayError('Esta sessão de replay já foi encerrada.');
    return r;
  }

  private state(r: Row): { book: ReplayBook; last: Candle } {
    const candles = JSON.parse(r.candles) as Candle[];
    return { book: JSON.parse(r.book) as ReplayBook, last: candles[r.cursor - 1] as Candle };
  }

  private save(id: string, u: { cursor?: number; book?: ReplayBook; status?: 'encerrada' }) {
    this.db
      .update(replaySessions)
      .set({
        ...(u.cursor !== undefined ? { cursor: u.cursor } : {}),
        ...(u.book ? { book: JSON.stringify(u.book) } : {}),
        ...(u.status ? { status: u.status } : {}),
        updatedAt: this.now(),
      })
      .where(eq(replaySessions.id, id))
      .run();
  }

  private toView(r: Row): ReplayView {
    const meta = JSON.parse(r.meta) as SymbolMeta;
    const all = JSON.parse(r.candles) as Candle[];
    const candles = all.slice(0, r.cursor);
    const book = JSON.parse(r.book) as ReplayBook;
    const masked = r.hidden && r.status === 'ativa';
    return {
      id: r.id,
      hidden: r.hidden,
      status: r.status,
      tf: r.tf as Timeframe,
      symbol: masked ? 'Ativo sorteado' : meta.symbol,
      symbolId: masked ? null : r.symbolId,
      meta: masked
        ? { ...meta, id: 'oculto', symbol: 'Ativo sorteado', name: 'Ativo sorteado' }
        : meta,
      candles,
      cursor: r.cursor,
      total: all.length,
      startIndex: r.startIndex,
      book,
      equity: replayEquity(book, candles.at(-1)?.close ?? null),
      createdAt: r.createdAt,
    };
  }

  private changed(userId: number) {
    this.sync.notify(userId, { type: 'sync', topic: 'replay' });
  }
}
