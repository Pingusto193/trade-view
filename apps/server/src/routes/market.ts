import { candlesQuerySchema, clientMessageSchema, type ServerMessage } from '@radar/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MarketHub } from '../market/hub';
import type { MarketService } from '../market/service';
import type { SyncHub } from '../sync';

const MAX_SUBS_PER_SOCKET = 24;

export function marketRoutes(
  app: FastifyInstance,
  market: MarketService,
  hub: MarketHub,
  simulated: boolean,
  sync: SyncHub,
) {
  app.get('/api/sources', async () => ({
    simulated,
    sources: market.registry.all.map((a) => ({
      id: a.id,
      label: a.label,
      market: a.market,
      configured: a.isConfigured(),
      simulated: Boolean(a.simulated),
    })),
  }));

  app.get('/api/symbols/search', async (req) => {
    const q = z.object({ q: z.string().max(40).default('') }).parse(req.query);
    return { results: await market.registry.search(q.q) };
  });

  app.get('/api/meta', async (req, reply) => {
    const q = z.object({ id: z.string().min(3).max(60) }).parse(req.query);
    try {
      return await market.getMeta(q.id);
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  app.get('/api/candles', async (req, reply) => {
    const q = candlesQuerySchema.parse(req.query);
    try {
      return await market.getCandles(q.id, q.tf, q.limit ?? 1500);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  /**
   * WebSocket de tempo real. Mensagens validadas com zod (protocolo em @radar/shared).
   */
  app.get('/ws', { websocket: true }, (socket, req) => {
    const subs = new Map<string, () => void>();
    const send = (msg: ServerMessage) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(msg));
    };
    const offSync = req.user ? sync.register(req.user.id, send) : () => undefined;
    socket.on('message', (raw: Buffer) => {
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        send({ type: 'error', message: 'mensagem inválida (JSON)' });
        return;
      }
      const parsed = clientMessageSchema.safeParse(data);
      if (!parsed.success) {
        send({ type: 'error', message: 'mensagem inválida' });
        return;
      }
      const m = parsed.data;
      if (m.type === 'ping') return send({ type: 'pong' });
      const key = `${m.id}|${m.tf}`;
      if (m.type === 'subscribe') {
        if (subs.has(key)) return;
        if (subs.size >= MAX_SUBS_PER_SOCKET) {
          send({
            type: 'error',
            message: `limite de ${MAX_SUBS_PER_SOCKET} assinaturas por conexão`,
          });
          return;
        }
        subs.set(key, hub.subscribe(m.id, m.tf, send));
      } else {
        subs.get(key)?.();
        subs.delete(key);
      }
    });
    socket.on('close', () => {
      offSync();
      for (const off of subs.values()) off();
      subs.clear();
    });
  });
}
