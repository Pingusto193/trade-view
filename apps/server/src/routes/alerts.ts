import {
  alertInputSchema,
  CHANNELS,
  notifySettingsInputSchema,
  pushSubscriptionSchema,
} from '@radar/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import type { AlertService } from '../alerts/service';
import type { Notifier } from '../notify/notifier';
import type { SyncHub } from '../sync';

const MAX_ALERTS = 300;

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

function originOf(req: FastifyRequest): string | undefined {
  const h = req.headers['x-radar-client'];
  return typeof h === 'string' && h.length <= 64 ? h : undefined;
}

const idParam = z.object({ id: z.string().min(8).max(64) });

/** Alertas (SPEC §10) e canais de notificação. */
export function alertRoutes(
  app: FastifyInstance,
  service: AlertService,
  notifier: Notifier,
  sync: SyncHub,
  publicUrl: string,
) {
  const changed = (req: FastifyRequest, userId: number) => {
    const origin = originOf(req);
    sync.notify(userId, { type: 'sync', topic: 'alerts', ...(origin ? { origin } : {}) });
  };

  app.get('/api/alerts', async (req) => ({ alerts: service.list(userOf(req).id) }));

  app.post('/api/alerts', async (req, reply) => {
    const u = userOf(req);
    const input = alertInputSchema.parse(req.body);
    if (service.list(u.id).length >= MAX_ALERTS) {
      return reply.code(400).send({ error: `limite de ${MAX_ALERTS} alertas` });
    }
    const a = await service.create(u.id, input);
    changed(req, u.id);
    return a;
  });

  app.put('/api/alerts/:id', async (req, reply) => {
    const u = userOf(req);
    const { id } = idParam.parse(req.params);
    const a = await service.update(u.id, id, alertInputSchema.parse(req.body));
    if (!a) return reply.code(404).send({ error: 'alerta não encontrado' });
    changed(req, u.id);
    return a;
  });

  app.delete('/api/alerts/:id', async (req, reply) => {
    const u = userOf(req);
    const { id } = idParam.parse(req.params);
    if (!(await service.remove(u.id, id))) {
      return reply.code(404).send({ error: 'alerta não encontrado' });
    }
    changed(req, u.id);
    return { ok: true };
  });

  app.get('/api/alerts/history', async (req) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(req.query);
    return { fires: service.history(userOf(req).id, limit) };
  });

  // ---------------------------------------------------------------- canais

  app.get('/api/notify/settings', async (req) => notifier.settings(userOf(req).id));

  app.put('/api/notify/settings', async (req) => {
    const u = userOf(req);
    return notifier.saveSettings(u.id, notifySettingsInputSchema.parse(req.body));
  });

  app.post('/api/notify/push', async (req) => {
    const u = userOf(req);
    const id = notifier.addPush(u.id, pushSubscriptionSchema.parse(req.body));
    return { id };
  });

  app.delete('/api/notify/push/:id', async (req, reply) => {
    const u = userOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!notifier.removePush(u.id, id))
      return reply.code(404).send({ error: 'aparelho não encontrado' });
    return { ok: true };
  });

  app.post('/api/notify/test', async (req) => {
    const u = userOf(req);
    const { channel } = z.object({ channel: z.enum(CHANNELS) }).parse(req.body);
    const { delivery } = await notifier.deliver(
      u.id,
      {
        title: 'Radar — teste',
        body: 'Se você está lendo isto, este canal funciona. Nenhum alerta foi disparado.',
        url: `${publicUrl.replace(/\/$/, '')}/alertas`,
        tag: 'teste',
      },
      [channel],
      { ignoreQuiet: true },
    );
    return { result: delivery[channel] ?? 'erro: sem resposta' };
  });

  app.post('/api/notify/telegram/detect', async (req, reply) => {
    const u = userOf(req);
    try {
      const chat = await notifier.detectTelegramChat(u.id);
      if (!chat) {
        return reply.code(404).send({
          error: 'Nenhuma mensagem encontrada. Mande /start para o seu bot e tente de novo.',
        });
      }
      notifier.saveSettings(u.id, {
        ...notifier.settings(u.id),
        telegramChatId: chat.chatId,
      });
      return chat;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
