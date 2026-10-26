import { NEWS_KINDS, newsAiSettingsInputSchema, newsQuerySchema } from '@radar/shared';
import { upcomingEvents } from '@radar/data';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import { NewsAiError, type NewsAiService } from '../news/ai';
import type { NewsService } from '../news/service';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

const csv = (v: unknown) =>
  typeof v === 'string' && v.trim()
    ? v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;

/** Notícias (SPEC §23.1): feed filtrado pelos ativos, saúde das fontes e leitura manual. */
export function newsRoutes(app: FastifyInstance, news: NewsService, ai: NewsAiService) {
  // resumo por IA: configuração (a chave fica no Assistente e nunca volta ao navegador)
  app.get('/api/news/ai', async (req) => ai.settings(userOf(req).id));
  app.put('/api/news/ai', async (req, reply) => {
    const user = userOf(req);
    try {
      return ai.save(user.id, newsAiSettingsInputSchema.parse(req.body));
    } catch (e) {
      if (e instanceof NewsAiError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });
  app.post(
    '/api/news/:id/summary',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      userOf(req);
      const { id } = z.object({ id: z.string().min(8).max(64) }).parse(req.params);
      try {
        return { ai: await ai.summarize(id) };
      } catch (e) {
        if (e instanceof NewsAiError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  app.get('/api/news', async (req) => {
    const q = req.query as Record<string, unknown>;
    const parsed = newsQuerySchema.parse({
      symbols: csv(q.symbols),
      kinds: csv(q.kinds)?.filter((k): k is (typeof NEWS_KINDS)[number] =>
        (NEWS_KINDS as readonly string[]).includes(k),
      ),
      since: q.since !== undefined ? Number(q.since) : undefined,
      limit: q.limit !== undefined ? Number(q.limit) : undefined,
      duplicates: q.duplicates === '1' || q.duplicates === 'true',
    });
    return { items: news.query(parsed) };
  });

  app.get('/api/news/sources', async () => ({ sources: news.sources() }));

  // agenda econômica (Copom, FOMC…): próximos eventos e os das últimas 6 horas
  app.get('/api/news/agenda', async () => ({
    events: upcomingEvents(news.nowMs(), 12, 6 * 3_600_000),
  }));

  app.post(
    '/api/news/sources/:id/poll',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().max(60) }).parse(req.params);
      try {
        return await news.poll(id);
      } catch (e) {
        return reply.code(502).send({ error: (e as Error).message });
      }
    },
  );
}
