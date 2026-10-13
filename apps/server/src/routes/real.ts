import { realFillInputSchema, realTradeInputSchema, realTradeUpdateSchema } from '@radar/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import { RealError, type RealJournalService } from '../real/service';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

const idParam = z.object({ id: z.string().min(8).max(64) });
const fillParam = idParam.extend({ fillId: z.string().min(8).max(64) });

async function guard<T>(reply: FastifyReply, fn: () => T | Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RealError) return reply.code(err.status).send({ error: err.message });
    throw err;
  }
}

/** Diário de trades reais (SPEC §13): o Radar só registra; não envia ordens. */
export function realRoutes(app: FastifyInstance, real: RealJournalService) {
  app.get('/api/real/journal', async (req) => real.journal(userOf(req).id));

  app.post('/api/real/trades', async (req, reply) =>
    guard(reply, () => real.create(userOf(req).id, realTradeInputSchema.parse(req.body))),
  );

  app.patch('/api/real/trades/:id', async (req, reply) =>
    guard(reply, () =>
      real.update(
        userOf(req).id,
        idParam.parse(req.params).id,
        realTradeUpdateSchema.parse(req.body),
      ),
    ),
  );

  app.delete('/api/real/trades/:id', async (req, reply) =>
    guard(reply, () => {
      real.remove(userOf(req).id, idParam.parse(req.params).id);
      return { ok: true };
    }),
  );

  app.post('/api/real/trades/:id/fills', async (req, reply) =>
    guard(reply, () =>
      real.addFill(
        userOf(req).id,
        idParam.parse(req.params).id,
        realFillInputSchema.parse(req.body),
      ),
    ),
  );

  app.delete('/api/real/trades/:id/fills/:fillId', async (req, reply) =>
    guard(reply, () => {
      const p = fillParam.parse(req.params);
      return real.removeFill(userOf(req).id, p.id, p.fillId);
    }),
  );

  app.get('/api/real/trades/:id/screenshot', async (req, reply) =>
    guard(reply, () => ({
      screenshot: real.screenshot(userOf(req).id, idParam.parse(req.params).id),
    })),
  );
}
