import { assistantAskSchema, assistantSettingsInputSchema } from '@radar/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, type PublicUser } from '../auth/service';
import { AssistantError, type AssistantService } from '../assistant/service';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

async function guard<T>(reply: FastifyReply, fn: () => T | Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AssistantError) return reply.code(err.status).send({ error: err.message });
    throw err;
  }
}

/** Assistente com IA (SPEC §16): opcional, desligado por padrão, com a chave do próprio usuário. */
export function assistantRoutes(app: FastifyInstance, assistant: AssistantService) {
  app.get('/api/assistant/settings', async (req) => assistant.settings(userOf(req).id));
  app.put('/api/assistant/settings', async (req, reply) =>
    guard(reply, () =>
      assistant.save(userOf(req).id, assistantSettingsInputSchema.parse(req.body)),
    ),
  );
  app.get('/api/assistant/models', async (req, reply) =>
    guard(reply, async () => ({ models: await assistant.models(userOf(req).id) })),
  );
  // cada pergunta custa dinheiro: limite próprio, além do geral
  app.post(
    '/api/assistant/ask',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) =>
      guard(reply, () => assistant.ask(userOf(req).id, assistantAskSchema.parse(req.body))),
  );
}
