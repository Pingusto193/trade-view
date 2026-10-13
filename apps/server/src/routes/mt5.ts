import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import type { Mt5Service } from '../mt5/service';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

/** Rota do agente: fica fora do login por cookie (autenticada pelo token), ver `installAuthGuard`. */
export const MT5_INGEST_PATH = '/api/mt5/ingest';

/**
 * Agente MetaTrader 5 (ADR-0023).
 * - `POST /api/mt5/ingest`: o agente do PC manda barras com `Authorization: Bearer <token>`.
 * - `GET/POST/DELETE /api/mt5/...`: tela Fontes de dados (atrás de login) gera e revoga tokens.
 */
export function mt5Routes(app: FastifyInstance, mt5: Mt5Service, publicUrl: string) {
  // ~1 envio por segundo por agente; folga para 2 agentes no mesmo IP e recarregamentos
  app.post(
    MT5_INGEST_PATH,
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const tok = mt5.authenticate(req.headers.authorization);
      if (!tok) {
        return reply.code(401).send({
          error:
            'Token do agente MT5 inválido ou revogado: gere outro no Radar em Mais → Fontes de dados.',
        });
      }
      const r = mt5.ingest(tok, req.body);
      return reply.code(r.status).send(r.body);
    },
  );

  app.get('/api/mt5/agents', async (req) => ({
    agents: mt5.listAgents(userOf(req).id),
    simulatedAllowed: mt5.simulatedAllowed,
    url: publicUrl.replace(/\/$/, ''),
  }));

  app.post('/api/mt5/tokens', async (req) => {
    const b = z.object({ name: z.string().max(60).default('') }).parse(req.body ?? {});
    return { ...mt5.createToken(userOf(req).id, b.name), url: publicUrl.replace(/\/$/, '') };
  });

  app.delete('/api/mt5/tokens/:id', async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    mt5.revoke(userOf(req).id, id);
    return { ok: true };
  });
}
