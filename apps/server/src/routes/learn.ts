import { exerciseAnswerSchema, exerciseCreateSchema } from '@radar/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import { LearnError, type LearnService } from '../learn/service';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

const idParam = z.object({ id: z.string().min(8).max(64) });

async function guard<T>(reply: FastifyReply, fn: () => T | Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LearnError) return reply.code(err.status).send({ error: err.message });
    throw err;
  }
}

/** Exercícios de leitura e trilha (SPEC §13). */
export function learnRoutes(app: FastifyInstance, learn: LearnService) {
  app.post('/api/exercises', async (req, reply) =>
    guard(reply, () => learn.create(userOf(req).id, exerciseCreateSchema.parse(req.body ?? {}))),
  );
  app.post('/api/exercises/:id/answer', async (req, reply) =>
    guard(reply, () =>
      learn.answer(
        userOf(req).id,
        idParam.parse(req.params).id,
        exerciseAnswerSchema.parse(req.body).answers,
      ),
    ),
  );
  app.get('/api/exercises/stats', async (req) => ({ levels: learn.stats(userOf(req).id) }));
  app.get('/api/trail', async (req) => learn.trail(userOf(req).id));
}
