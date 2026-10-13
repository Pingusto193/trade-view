import { replayCreateSchema, replayMoveSchema, replayOrderSchema } from '@radar/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import { ReplayError, type ReplayService } from '../replay/service';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

const idParam = z.object({ id: z.string().min(8).max(64) });
const subParam = idParam.extend({ sub: z.string().min(8).max(64) });

async function guard<T>(reply: FastifyReply, fn: () => T | Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ReplayError) return reply.code(err.status).send({ error: err.message });
    throw err;
  }
}

/** Replay (SPEC §13): o servidor só entrega candles já revelados. */
export function replayRoutes(app: FastifyInstance, replay: ReplayService) {
  app.get('/api/replay/sessions', async (req) => ({ sessions: replay.list(userOf(req).id) }));
  app.get('/api/replay/journal', async (req) => replay.journal(userOf(req).id));

  app.post('/api/replay/sessions', async (req, reply) =>
    guard(reply, () => replay.create(userOf(req).id, replayCreateSchema.parse(req.body ?? {}))),
  );
  app.get('/api/replay/sessions/:id', async (req, reply) =>
    guard(reply, () => replay.view(userOf(req).id, idParam.parse(req.params).id)),
  );
  app.delete('/api/replay/sessions/:id', async (req, reply) =>
    guard(reply, () => {
      replay.remove(userOf(req).id, idParam.parse(req.params).id);
      return { ok: true };
    }),
  );
  app.post('/api/replay/sessions/:id/advance', async (req, reply) => {
    const { n } = z
      .object({ n: z.number().int().min(1).max(1000).default(1) })
      .parse(req.body ?? {});
    return guard(reply, () => replay.advance(userOf(req).id, idParam.parse(req.params).id, n));
  });
  app.post('/api/replay/sessions/:id/orders', async (req, reply) =>
    guard(reply, () =>
      replay.order(userOf(req).id, idParam.parse(req.params).id, replayOrderSchema.parse(req.body)),
    ),
  );
  app.delete('/api/replay/sessions/:id/orders/:sub', async (req, reply) =>
    guard(reply, () => {
      const p = subParam.parse(req.params);
      return replay.cancel(userOf(req).id, p.id, p.sub);
    }),
  );
  app.patch('/api/replay/sessions/:id/position', async (req, reply) =>
    guard(reply, () =>
      replay.move(userOf(req).id, idParam.parse(req.params).id, replayMoveSchema.parse(req.body)),
    ),
  );
  app.post('/api/replay/sessions/:id/end', async (req, reply) =>
    guard(reply, () => replay.end(userOf(req).id, idParam.parse(req.params).id)),
  );
  app.get('/api/replay/sessions/:id/trades/:sub/feedback', async (req, reply) =>
    guard(reply, () => {
      const p = subParam.parse(req.params);
      return replay.feedback(userOf(req).id, p.id, p.sub);
    }),
  );
}
