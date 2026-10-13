import { indicatorPresetSchema } from '@radar/core';
import { drawingSchema, prefsSchema, type Drawing } from '@radar/shared';
import { and, asc, eq, isNull, max } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import type { Db } from '../db/client';
import { drawings, indicatorPresets, preferences, watchlistItems, watchlists } from '../db/schema';
import { readPrefs } from '../prefs';
import type { SyncHub } from '../sync';

const DEFAULT_WATCHLIST = [
  'binance:BTCUSDT',
  'binance:ETHUSDT',
  'brapi:PETR4',
  'brapi:VALE3',
  'alpaca:AAPL',
];

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

/** Identificador da aba/aparelho que fez a mudança (para não recarregar a própria tela). */
function originOf(req: FastifyRequest): string | undefined {
  const h = req.headers['x-radar-client'];
  return typeof h === 'string' && h.length <= 64 ? h : undefined;
}

export function userDataRoutes(
  app: FastifyInstance,
  db: Db,
  sync: SyncHub,
  now: () => number = Date.now,
) {
  // ------------------------------------------------------------------ desenhos

  app.get('/api/drawings', async (req) => {
    const u = userOf(req);
    const q = z.object({ symbolId: z.string().min(3).max(60) }).parse(req.query);
    const rows = db
      .select()
      .from(drawings)
      .where(
        and(
          eq(drawings.userId, u.id),
          eq(drawings.symbolId, q.symbolId),
          isNull(drawings.deletedAt),
        ),
      )
      .orderBy(asc(drawings.updatedAt))
      .all();
    const list: Drawing[] = rows.map((r) => ({
      id: r.id,
      symbolId: r.symbolId,
      tf: (r.tf as Drawing['tf']) ?? null,
      locked: r.locked,
      hidden: r.hidden,
      ...(JSON.parse(r.json) as Pick<Drawing, 'style' | 'data'>),
      rev: r.rev,
      updatedAt: r.updatedAt,
    }));
    return { drawings: list };
  });

  app.put('/api/drawings/:id', async (req, reply) => {
    const u = userOf(req);
    const { id } = z.object({ id: z.string().min(8).max(64) }).parse(req.params);
    const d = drawingSchema.parse({ ...(req.body as object), id });
    const existing = db.select().from(drawings).where(eq(drawings.id, id)).get();
    if (existing && existing.userId !== u.id)
      return reply.code(404).send({ error: 'desenho não encontrado' });
    const rev =
      (db
        .select({ m: max(drawings.rev) })
        .from(drawings)
        .where(eq(drawings.userId, u.id))
        .get()?.m ?? 0) + 1;
    const row = {
      id,
      userId: u.id,
      symbolId: d.symbolId,
      tf: d.tf,
      kind: d.data.kind,
      json: JSON.stringify({ style: d.style, data: d.data }),
      locked: d.locked,
      hidden: d.hidden,
      rev,
      updatedAt: now(),
      deletedAt: null,
    };
    db.insert(drawings).values(row).onConflictDoUpdate({ target: drawings.id, set: row }).run();
    const origin = originOf(req);
    sync.notify(u.id, {
      type: 'sync',
      topic: 'drawings',
      symbolId: d.symbolId,
      ...(origin ? { origin } : {}),
    });
    return { ...d, rev, updatedAt: row.updatedAt };
  });

  app.delete('/api/drawings/:id', async (req, reply) => {
    const u = userOf(req);
    const { id } = z.object({ id: z.string().min(8).max(64) }).parse(req.params);
    const existing = db.select().from(drawings).where(eq(drawings.id, id)).get();
    if (!existing || existing.userId !== u.id)
      return reply.code(404).send({ error: 'desenho não encontrado' });
    const rev =
      (db
        .select({ m: max(drawings.rev) })
        .from(drawings)
        .where(eq(drawings.userId, u.id))
        .get()?.m ?? 0) + 1;
    db.update(drawings)
      .set({ deletedAt: now(), rev, updatedAt: now() })
      .where(eq(drawings.id, id))
      .run();
    const origin = originOf(req);
    sync.notify(u.id, {
      type: 'sync',
      topic: 'drawings',
      symbolId: existing.symbolId,
      ...(origin ? { origin } : {}),
    });
    return { ok: true };
  });

  // ------------------------------------------------------------------ watchlists

  const listWatchlists = (userId: number) => {
    const lists = db
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, userId))
      .orderBy(asc(watchlists.position), asc(watchlists.id))
      .all();
    return lists.map((l) => ({
      id: l.id,
      name: l.name,
      items: db
        .select({ s: watchlistItems.symbolId })
        .from(watchlistItems)
        .where(eq(watchlistItems.watchlistId, l.id))
        .orderBy(asc(watchlistItems.position))
        .all()
        .map((r) => r.s),
    }));
  };

  const ownList = (userId: number, id: number) => {
    const l = db.select().from(watchlists).where(eq(watchlists.id, id)).get();
    if (!l || l.userId !== userId) throw new AuthError('lista não encontrada', 404);
    return l;
  };

  const writeItems = (listId: number, items: readonly string[]) => {
    db.delete(watchlistItems).where(eq(watchlistItems.watchlistId, listId)).run();
    const seen = new Set<string>();
    items.forEach((s, i) => {
      if (seen.has(s)) return;
      seen.add(s);
      db.insert(watchlistItems)
        .values({ watchlistId: listId, symbolId: s, position: i, addedAt: now() })
        .run();
    });
  };

  app.get('/api/watchlists', async (req) => {
    const u = userOf(req);
    let lists = listWatchlists(u.id);
    if (lists.length === 0) {
      const l = db
        .insert(watchlists)
        .values({ userId: u.id, name: 'Minha lista', position: 0, createdAt: now() })
        .returning()
        .get();
      writeItems(l.id, DEFAULT_WATCHLIST);
      lists = listWatchlists(u.id);
    }
    return { watchlists: lists };
  });

  const body = z.object({
    name: z.string().trim().min(1).max(60),
    items: z.array(z.string().min(3).max(60)).max(500).default([]),
  });

  app.post('/api/watchlists', async (req) => {
    const u = userOf(req);
    const b = body.parse(req.body);
    const l = db
      .insert(watchlists)
      .values({ userId: u.id, name: b.name, position: 99, createdAt: now() })
      .returning()
      .get();
    writeItems(l.id, b.items);
    const origin = originOf(req);
    sync.notify(u.id, { type: 'sync', topic: 'watchlists', ...(origin ? { origin } : {}) });
    return { id: l.id, name: l.name, items: b.items };
  });

  app.put('/api/watchlists/:id', async (req) => {
    const u = userOf(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    ownList(u.id, id);
    const b = body.parse(req.body);
    db.update(watchlists).set({ name: b.name }).where(eq(watchlists.id, id)).run();
    writeItems(id, b.items);
    const origin = originOf(req);
    sync.notify(u.id, { type: 'sync', topic: 'watchlists', ...(origin ? { origin } : {}) });
    return { id, name: b.name, items: b.items };
  });

  app.delete('/api/watchlists/:id', async (req) => {
    const u = userOf(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    ownList(u.id, id);
    db.delete(watchlists).where(eq(watchlists.id, id)).run();
    const origin = originOf(req);
    sync.notify(u.id, { type: 'sync', topic: 'watchlists', ...(origin ? { origin } : {}) });
    return { ok: true };
  });

  // ------------------------------------------------------------------ presets de indicadores

  app.get('/api/presets', async (req) => {
    const u = userOf(req);
    const rows = db
      .select()
      .from(indicatorPresets)
      .where(eq(indicatorPresets.userId, u.id))
      .orderBy(asc(indicatorPresets.name))
      .all();
    return { presets: rows.map((r) => indicatorPresetSchema.parse(JSON.parse(r.json))) };
  });

  app.put('/api/presets/:id', async (req, reply) => {
    const u = userOf(req);
    const { id } = z.object({ id: z.string().min(3).max(64) }).parse(req.params);
    const p = indicatorPresetSchema.parse({ ...(req.body as object), id, builtIn: false });
    if (id === 'padrao-do-canal' || id === 'limpo')
      return reply
        .code(400)
        .send({ error: 'presets prontos não podem ser alterados; salve uma cópia' });
    const existing = db.select().from(indicatorPresets).where(eq(indicatorPresets.id, id)).get();
    if (existing && existing.userId !== u.id)
      return reply.code(404).send({ error: 'preset não encontrado' });
    const row = { id, userId: u.id, name: p.name, json: JSON.stringify(p), updatedAt: now() };
    db.insert(indicatorPresets)
      .values(row)
      .onConflictDoUpdate({ target: indicatorPresets.id, set: row })
      .run();
    const origin = originOf(req);
    sync.notify(u.id, { type: 'sync', topic: 'presets', ...(origin ? { origin } : {}) });
    return p;
  });

  app.delete('/api/presets/:id', async (req, reply) => {
    const u = userOf(req);
    const { id } = z.object({ id: z.string().min(3).max(64) }).parse(req.params);
    const existing = db.select().from(indicatorPresets).where(eq(indicatorPresets.id, id)).get();
    if (!existing || existing.userId !== u.id)
      return reply.code(404).send({ error: 'preset não encontrado' });
    db.delete(indicatorPresets).where(eq(indicatorPresets.id, id)).run();
    const origin = originOf(req);
    sync.notify(u.id, { type: 'sync', topic: 'presets', ...(origin ? { origin } : {}) });
    return { ok: true };
  });

  // ------------------------------------------------------------------ preferências

  app.get('/api/prefs', async (req) => readPrefs(db, userOf(req).id));

  app.put('/api/prefs', async (req) => {
    const u = userOf(req);
    const merged = prefsSchema.parse({ ...readPrefs(db, u.id), ...(req.body as object) });
    const row = { userId: u.id, json: JSON.stringify(merged), updatedAt: now() };
    db.insert(preferences)
      .values(row)
      .onConflictDoUpdate({ target: preferences.userId, set: row })
      .run();
    const origin = originOf(req);
    sync.notify(u.id, { type: 'sync', topic: 'prefs', ...(origin ? { origin } : {}) });
    return merged;
  });
}
