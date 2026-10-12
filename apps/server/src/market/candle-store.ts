import type { Candle, Timeframe } from '@radar/shared';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { candles, seriesFetch } from '../db/schema';

/**
 * Cache de candles no SQLite (SPEC §6 — "o histórico baixado fica no SQLite").
 * Respeita os termos de uso: é cache para uso pessoal, nunca redistribuído.
 */
export class CandleStore {
  constructor(private readonly db: Db) {}

  save(symbolId: string, tf: Timeframe, list: readonly Candle[]): void {
    if (!list.length) return;
    const sqlite = this.db.$client;
    const stmt = sqlite.prepare(
      `INSERT INTO candles (symbol_id, tf, time, open, high, low, close, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol_id, tf, time) DO UPDATE SET
         open = excluded.open, high = excluded.high, low = excluded.low,
         close = excluded.close, volume = excluded.volume`,
    );
    const tx = sqlite.transaction((rows: readonly Candle[]) => {
      for (const c of rows)
        stmt.run(symbolId, tf, c.time, c.open, c.high, c.low, c.close, c.volume);
    });
    tx(list);
  }

  /** Últimos `limit` candles (ordem crescente), opcionalmente dentro de [from, to]. */
  load(
    symbolId: string,
    tf: Timeframe,
    opts: { from?: number; to?: number; limit?: number } = {},
  ): Candle[] {
    const conds = [eq(candles.symbolId, symbolId), eq(candles.tf, tf)];
    if (opts.from !== undefined) conds.push(gte(candles.time, opts.from));
    if (opts.to !== undefined) conds.push(lte(candles.time, opts.to));
    const q = this.db
      .select({
        time: candles.time,
        open: candles.open,
        high: candles.high,
        low: candles.low,
        close: candles.close,
        volume: candles.volume,
      })
      .from(candles)
      .where(and(...conds));
    if (opts.limit) {
      return q.orderBy(desc(candles.time)).limit(opts.limit).all().reverse();
    }
    return q.orderBy(asc(candles.time)).all();
  }

  markFetched(symbolId: string, tf: Timeframe, at: number): void {
    this.db
      .insert(seriesFetch)
      .values({ symbolId, tf, fetchedAt: at, lastError: null, lastErrorAt: null })
      .onConflictDoUpdate({
        target: [seriesFetch.symbolId, seriesFetch.tf],
        set: { fetchedAt: at, lastError: null, lastErrorAt: null },
      })
      .run();
  }

  markError(symbolId: string, tf: Timeframe, message: string, at: number): void {
    this.db
      .insert(seriesFetch)
      .values({ symbolId, tf, fetchedAt: 0, lastError: message, lastErrorAt: at })
      .onConflictDoUpdate({
        target: [seriesFetch.symbolId, seriesFetch.tf],
        set: { lastError: message, lastErrorAt: at },
      })
      .run();
  }

  fetchInfo(symbolId: string, tf: Timeframe) {
    return this.db
      .select()
      .from(seriesFetch)
      .where(and(eq(seriesFetch.symbolId, symbolId), eq(seriesFetch.tf, tf)))
      .get();
  }
}
