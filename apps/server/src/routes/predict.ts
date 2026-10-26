import { timeframeSchema } from '@radar/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import type { PredictService } from '../predict/service';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

const targetSchema = z.object({ symbolId: z.string().min(3).max(64), tf: timeframeSchema });
const filterSchema = z.object({
  symbolId: z.string().min(3).max(64).optional(),
  tf: timeframeSchema.optional(),
  horizon: z.coerce.number().int().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** Previsão honesta (SPEC §23.2): alvos do placar, previsões gravadas e placar ao vivo. */
export function predictRoutes(app: FastifyInstance, predict: PredictService) {
  app.get('/api/predict/targets', async (req) => ({
    targets: predict.targets(userOf(req).id),
    status: predict.status(),
    params: predict.params,
  }));

  app.post('/api/predict/targets', async (req, reply) => {
    const user = userOf(req);
    const t = targetSchema.parse(req.body);
    try {
      await predict.addTarget(user.id, t.symbolId, t.tf);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    return { targets: predict.targets(user.id) };
  });

  app.delete('/api/predict/targets', async (req) => {
    const user = userOf(req);
    const t = targetSchema.parse(req.query);
    await predict.removeTarget(user.id, t.symbolId, t.tf);
    return { targets: predict.targets(user.id) };
  });

  app.get('/api/predict/predictions', async (req) => {
    userOf(req);
    return { predictions: predict.list(filterSchema.parse(req.query)) };
  });

  app.get('/api/predict/scoreboard', async (req) => {
    userOf(req);
    const q = filterSchema.parse(req.query);
    return {
      entries: predict.scoreboard({
        ...(q.symbolId ? { symbolId: q.symbolId } : {}),
        ...(q.tf ? { tf: q.tf } : {}),
      }),
      minCases: predict.params.minCases,
    };
  });
}
