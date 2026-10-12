import { experimentIdSchema, experimentRunInputSchema } from '@radar/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import type { ExperimentService } from '../experiments/service';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

/** Experimentos "Verificar o youtuber" (SPEC §12.4). */
export function experimentRoutes(app: FastifyInstance, exp: ExperimentService) {
  app.get('/api/experiments', async (req) => ({ latest: exp.latest(userOf(req).id) }));

  app.post(
    '/api/experiments/:id/run',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const u = userOf(req);
      const { id } = z.object({ id: experimentIdSchema }).parse(req.params);
      const body = experimentRunInputSchema.parse(req.body);
      try {
        return exp.start(u.id, id, body.symbols);
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message });
      }
    },
  );

  app.get('/api/experiments/runs/:runId', async (req, reply) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(req.params);
    const run = exp.get(userOf(req).id, runId);
    if (!run) return reply.code(404).send({ error: 'execução não encontrada' });
    return run;
  });
}
