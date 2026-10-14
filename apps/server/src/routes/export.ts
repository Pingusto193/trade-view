import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AuthError, type PublicUser } from '../auth/service';
import type { Db } from '../db/client';
import type { SyncHub } from '../sync';
import { ImportError, exportUser, importUser } from '../userdata/export';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

const TOPICS = [
  'drawings',
  'watchlists',
  'presets',
  'prefs',
  'alerts',
  'paper',
  'scanner',
  'real',
  'replay',
] as const;

/** Exportar/importar todos os dados do usuário em JSON (SPEC §17). */
export function exportRoutes(
  app: FastifyInstance,
  db: Db,
  sync: SyncHub,
  after: { reload(userId: number): Promise<void> },
  now: () => number = Date.now,
) {
  app.get('/api/export', async (req, reply) => {
    const u = userOf(req);
    const day = new Date(now()).toISOString().slice(0, 10);
    reply.header('content-disposition', `attachment; filename="radar-${day}.json"`);
    return exportUser(db, u.id, now());
  });

  // arquivos com replays e laboratório podem passar de alguns MB
  app.post('/api/import', { bodyLimit: 100 * 1024 * 1024 }, async (req, reply) => {
    const u = userOf(req);
    try {
      const r = importUser(db, u.id, req.body);
      await after.reload(u.id);
      for (const topic of TOPICS) sync.notify(u.id, { type: 'sync', topic });
      return r;
    } catch (e) {
      if (e instanceof ImportError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });
}
