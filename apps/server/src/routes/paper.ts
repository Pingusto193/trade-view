import {
  paperAccountInputSchema,
  paperAccountUpdateSchema,
  paperOrderInputSchema,
  paperPositionUpdateSchema,
} from '@radar/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import { PaperError, type PaperService } from '../paper/service';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

const idParam = z.object({ id: z.string().min(8).max(64) });

async function guard<T>(reply: FastifyReply, fn: () => T | Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PaperError) return reply.code(err.status).send({ error: err.message });
    throw err;
  }
}

/** Modo Treino (SPEC §13): contas fictícias, ordens e diário. */
export function paperRoutes(app: FastifyInstance, paper: PaperService) {
  app.get('/api/paper/accounts', async (req) => ({ accounts: paper.listAccounts(userOf(req).id) }));

  app.post('/api/paper/accounts', async (req, reply) =>
    guard(reply, () =>
      paper.createAccount(userOf(req).id, paperAccountInputSchema.parse(req.body ?? {})),
    ),
  );

  app.put('/api/paper/accounts/:id', async (req, reply) =>
    guard(reply, () =>
      paper.updateAccount(
        userOf(req).id,
        idParam.parse(req.params).id,
        paperAccountUpdateSchema.parse(req.body),
      ),
    ),
  );

  app.post('/api/paper/accounts/:id/reset', async (req, reply) => {
    const { initialBalance } = z
      .object({ initialBalance: z.number().min(100).max(1_000_000_000) })
      .parse(req.body);
    return guard(reply, () =>
      paper.resetAccount(userOf(req).id, idParam.parse(req.params).id, initialBalance),
    );
  });

  app.get('/api/paper/accounts/:id/state', async (req, reply) =>
    guard(reply, () => paper.state(userOf(req).id, idParam.parse(req.params).id)),
  );

  app.get('/api/paper/accounts/:id/journal', async (req, reply) => {
    const { all } = z.object({ all: z.enum(['0', '1']).default('0') }).parse(req.query);
    return guard(reply, () =>
      paper.journal(userOf(req).id, idParam.parse(req.params).id, all === '1'),
    );
  });

  app.post('/api/paper/orders', async (req, reply) =>
    guard(reply, () => paper.placeOrder(userOf(req).id, paperOrderInputSchema.parse(req.body))),
  );

  app.delete('/api/paper/orders/:id', async (req, reply) => {
    if (!paper.cancelOrder(userOf(req).id, idParam.parse(req.params).id)) {
      return reply.code(404).send({ error: 'ordem pendente não encontrada' });
    }
    return { ok: true };
  });

  app.get('/api/paper/positions/:id/screenshot', async (req, reply) => {
    const img = paper.planScreenshot(userOf(req).id, idParam.parse(req.params).id);
    if (!img) return reply.code(404).send({ error: 'sem print' });
    const m = /^data:(image\/(?:jpeg|png));base64,(.*)$/.exec(img);
    if (!m) return reply.code(404).send({ error: 'sem print' });
    return reply
      .header('content-type', m[1])
      .header('cache-control', 'private, max-age=86400')
      .send(Buffer.from(m[2]!, 'base64'));
  });

  /** Feedback depois do trade (SPEC §13): só do dono e só de trade encerrado. */
  app.get('/api/paper/positions/:id/feedback', async (req, reply) =>
    guard(reply, () => paper.feedback(userOf(req).id, idParam.parse(req.params).id)),
  );

  app.put('/api/paper/positions/:id', async (req, reply) =>
    guard(reply, () =>
      paper.updatePosition(
        userOf(req).id,
        idParam.parse(req.params).id,
        paperPositionUpdateSchema.parse(req.body),
      ),
    ),
  );
}
