import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { AdapterRegistry, BcbClient } from '@radar/data';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AlertService } from './alerts/service';
import { SecretBox } from './auth/crypto';
import { AuthError, AuthService } from './auth/service';
import type { Db } from './db/client';
import type { Env } from './env';
import { CandleStore } from './market/candle-store';
import { MarketHub } from './market/hub';
import { MarketService } from './market/service';
import { SmtpEmail, TelegramHttp, WebPushSender } from './notify/channels';
import { Notifier, type Senders } from './notify/notifier';
import { loadVapid } from './notify/vapid';
import { MacroService } from './macro/service';
import { PaperService } from './paper/service';
import { alertRoutes } from './routes/alerts';
import { macroRoutes } from './routes/macro';
import { paperRoutes } from './routes/paper';
import { authRoutes, installAuthGuard } from './routes/auth';
import { marketRoutes } from './routes/market';
import { userDataRoutes } from './routes/userdata';
import { SyncHub } from './sync';

export interface AppDeps {
  env: Env;
  db: Db;
  registry: AdapterRegistry;
  now?: () => number;
  logger?: boolean;
  /** Troca canais de notificação (testes usam canais falsos, sem internet). */
  senders?: Partial<Senders>;
  /** Cliente do Banco Central (testes usam fixtures). */
  bcb?: BcbClient;
}

export interface RadarApp {
  app: FastifyInstance;
  market: MarketService;
  hub: MarketHub;
  store: CandleStore;
  auth: AuthService;
  sync: SyncHub;
  alerts: AlertService;
  notifier: Notifier;
  paper: PaperService;
  macro: MacroService;
}

export async function buildApp(deps: AppDeps): Promise<RadarApp> {
  const { env, db, registry } = deps;
  const app = Fastify({
    logger:
      deps.logger === false ? false : { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    // req.ip pode faltar em conexões injetadas (testes); nunca em conexões reais.
    keyGenerator: (req) => req.ip ?? 'desconhecido',
  });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AuthError) {
      if (err.retryAfterMs) reply.header('retry-after', Math.ceil(err.retryAfterMs / 1000));
      return reply.code(err.status).send({ error: err.message });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'parâmetros inválidos', issues: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply
      .code(status)
      .send({ error: status >= 500 ? 'erro interno' : (err as Error).message });
  });

  const box = SecretBox.load(
    env.APP_SECRET,
    env.DATABASE_PATH === ':memory:' ? null : resolve(dirname(env.DATABASE_PATH), 'app-secret.key'),
  );
  const auth = new AuthService(db, box, deps.now);
  installAuthGuard(app, auth, env);
  authRoutes(app, auth, env);

  const store = new CandleStore(db);
  const market = new MarketService(registry, store, deps.now);
  const hub = new MarketHub(market, store, app.log);

  app.get('/api/health', async () => ({
    ok: true,
    name: 'Radar',
    time: Date.now(),
    simulated: env.RADAR_SIMULATED,
  }));

  const sync = new SyncHub();
  marketRoutes(app, market, hub, env.RADAR_SIMULATED, sync);
  userDataRoutes(app, db, sync, deps.now);

  const vapid = loadVapid(
    env,
    env.DATABASE_PATH === ':memory:' ? null : resolve(dirname(env.DATABASE_PATH), 'vapid.json'),
  );
  const senders: Senders = {
    push:
      deps.senders?.push ??
      new WebPushSender(
        vapid,
        env.VAPID_SUBJECT ?? `mailto:radar@${new URL(env.PUBLIC_URL).hostname}`,
      ),
    telegram: deps.senders?.telegram ?? new TelegramHttp(),
    email:
      deps.senders?.email ??
      new SmtpEmail({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from: env.SMTP_FROM,
      }),
  };
  const notifier = new Notifier(db, box, senders, vapid.publicKey, deps.now);
  const alerts = new AlertService(
    db,
    market,
    hub,
    notifier,
    sync,
    env.PUBLIC_URL,
    app.log,
    deps.now,
  );
  alertRoutes(app, alerts, notifier, sync, env.PUBLIC_URL);

  const paper = new PaperService(db, market, hub, sync, app.log, deps.now);
  paperRoutes(app, paper);

  const macro = new MacroService(db, deps.bcb, deps.now);
  macroRoutes(app, macro);

  // Produção: o servidor entrega o PWA (mesma origem → cookies e WebSocket sem CORS).
  const dist = env.WEB_DIST ? resolve(env.WEB_DIST) : null;
  if (dist && existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'não encontrado' });
      }
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    alerts.close();
    paper.close();
    hub.closeAll();
  });
  return { app, market, hub, store, auth, sync, alerts, notifier, paper, macro };
}
