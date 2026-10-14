import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError } from '../auth/service';
import type { FundamentalsService } from '../fundamentals/service';
import type { MarketService } from '../market/service';

function requireLogin(req: FastifyRequest): void {
  if (!req.user) throw new AuthError('Faça login.', 401);
}

/**
 * Fundamentos de hoje de um ativo (SEC EDGAR / CVM), os mesmos que o scanner e os alertas usam.
 * `fundamentals: null` = mercado sem fonte (cripto, forex, simulado). Atrás de login.
 */
export function fundamentalsRoutes(
  app: FastifyInstance,
  fund: FundamentalsService,
  market: MarketService,
) {
  app.get(
    '/api/fundamentals',
    // a primeira consulta de um ativo da B3 baixa os arquivos anuais da CVM: limite próprio
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      requireLogin(req);
      const q = z.object({ symbolId: z.string().min(3).max(64) }).parse(req.query);
      const meta = await market.getMeta(q.symbolId);
      return { symbolId: q.symbolId, fundamentals: await fund.forSymbol(meta) };
    },
  );
}
