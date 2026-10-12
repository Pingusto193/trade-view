import { labRunInputSchema } from '@radar/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import type { LabService } from '../lab/service';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

/** Laboratório (SPEC §12). */
export function labRoutes(app: FastifyInstance, lab: LabService) {
  app.post(
    '/api/lab/run',
    // backtest é pesado: limite próprio, mais baixo que o geral
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const u = userOf(req);
      try {
        return await lab.run(u.id, labRunInputSchema.parse(req.body));
      } catch (err) {
        if (err instanceof z.ZodError) throw err;
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get('/api/lab/runs', async (req) => ({ runs: lab.list(userOf(req).id) }));

  app.get('/api/lab/runs/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const run = lab.get(userOf(req).id, id);
    if (!run) return reply.code(404).send({ error: 'execução não encontrada' });
    return run;
  });
}
