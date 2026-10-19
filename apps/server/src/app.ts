import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { CvmClient, SecEdgarClient, type AdapterRegistry, type BcbClient } from '@radar/data';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AlertService } from './alerts/service';
import { SecretBox } from './auth/crypto';
import { AuthError, AuthService } from './auth/service';
import type { Db } from './db/client';
import type { Env } from './env';
import { FundamentalsService } from './fundamentals/service';
import { CandleStore } from './market/candle-store';
import { MarketHub } from './market/hub';
import { MarketService } from './market/service';
import { SmtpEmail, TelegramHttp, WebPushSender } from './notify/channels';
import { Notifier, type Senders } from './notify/notifier';
import { loadVapid } from './notify/vapid';
import { ExperimentService } from './experiments/service';
import { LabService } from './lab/service';
import { MacroService } from './macro/service';
import { Mt5Service } from './mt5/service';
import { PaperService } from './paper/service';
import { RealJournalService } from './real/service';
import { alertRoutes } from './routes/alerts';
import { experimentRoutes } from './routes/experiments';
import { fundamentalsRoutes } from './routes/fundamentals';
import { labRoutes } from './routes/lab';
import { macroRoutes } from './routes/macro';
import { paperRoutes } from './routes/paper';
import { realRoutes } from './routes/real';
import { replayRoutes } from './routes/replay';
import { learnRoutes } from './routes/learn';
import { exportRoutes } from './routes/export';
import { assistantRoutes } from './routes/assistant';
import { AssistantService, type AnthropicLike } from './assistant/service';
import { LearnService } from './learn/service';
import { ReplayService } from './replay/service';
import { authRoutes, installAuthGuard } from './routes/auth';
import { marketRoutes } from './routes/market';
import { mt5Routes } from './routes/mt5';
import { scannerRoutes } from './routes/scanner';
import { userDataRoutes } from './routes/userdata';
import { ScannerService } from './scanner/service';
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
  /** Fontes de fundamentos (testes usam fixtures). */
  sec?: SecEdgarClient;
  cvm?: CvmClient;
  /** Cliente da API da Anthropic por chave (testes usam um falso, sem internet). */
  anthropic?: (apiKey: string) => AnthropicLike;
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
  lab: LabService;
  experiments: ExperimentService;
  scanner: ScannerService;
  mt5: Mt5Service;
  fundamentals: FundamentalsService;
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
    max: env.RATE_LIMIT_MAX,
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

  // agente MetaTrader 5 (B3 em tempo real e forex): tokens, ingestão e fontes mt5/mt5sim (ADR-0023)
  const mt5 = new Mt5Service(db, registry, env.RADAR_SIMULATED, app.log, deps.now);
  mt5Routes(app, mt5, env.PUBLIC_URL);

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
  // fundamentos (SEC EDGAR e CVM): scanner, alertas de reflexividade e laboratório (ADR-0024)
  const fundamentals = new FundamentalsService(
    db,
    deps.sec ?? new SecEdgarClient(env.SEC_USER_AGENT ? { userAgent: env.SEC_USER_AGENT } : {}),
    deps.cvm ?? new CvmClient(),
    deps.now,
    app.log,
  );
  fundamentalsRoutes(app, fundamentals, market);
  const alerts = new AlertService(
    db,
    market,
    hub,
    notifier,
    sync,
    env.PUBLIC_URL,
    app.log,
    deps.now,
    fundamentals,
  );
  alertRoutes(app, alerts, notifier, sync, env.PUBLIC_URL);

  const paper = new PaperService(
    db,
    market,
    hub,
    sync,
    app.log,
    deps.now,
    async (userId, title, body, symbolId) => {
      // execuções do treino feitas pelo servidor: avisa nos canais já configurados
      const st = notifier.settings(userId);
      const channels = [
        ...(st.pushDevices.length ? (['push'] as const) : []),
        ...(st.telegramConfigured && st.telegramChatId ? (['telegram'] as const) : []),
      ];
      if (!channels.length) return;
      const url = `${env.PUBLIC_URL.replace(/\/$/, '')}/grafico?id=${encodeURIComponent(symbolId)}&tf=1d`;
      await notifier.deliver(userId, { title, body, url, tag: `treino-${symbolId}` }, channels);
    },
  );
  paperRoutes(app, paper);
  realRoutes(app, new RealJournalService(db, sync, deps.now));
  replayRoutes(app, new ReplayService(db, market, sync, env.RADAR_SIMULATED, deps.now));
  learnRoutes(app, new LearnService(db, market, env.RADAR_SIMULATED, deps.now));
  assistantRoutes(
    app,
    new AssistantService(
      db,
      box,
      {
        model: env.ASSISTANT_MODEL,
        priceIn: env.ASSISTANT_PRICE_IN,
        priceOut: env.ASSISTANT_PRICE_OUT,
      },
      deps.anthropic,
      deps.now,
    ),
  );
  exportRoutes(
    app,
    db,
    sync,
    {
      // depois de importar: alertas e treino voltam a acompanhar o que veio no arquivo
      reload: async (userId) => {
        await alerts.reloadUser(userId);
        await paper.start();
      },
    },
    deps.now,
  );

  const macro = new MacroService(db, deps.bcb, deps.now);
  macroRoutes(app, macro);

  const lab = new LabService(db, market, macro, deps.now, fundamentals);
  labRoutes(app, lab);
  const experiments = new ExperimentService(db, market, deps.now);
  experimentRoutes(app, experiments);
  const scanner = new ScannerService(
    db,
    market,
    hub,
    sync,
    app.log,
    env.RADAR_SIMULATED,
    deps.now,
    fundamentals,
  );
  scannerRoutes(app, scanner);

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
    scanner.close();
    hub.closeAll();
    mt5.close();
  });
  return {
    app,
    market,
    hub,
    store,
    auth,
    sync,
    alerts,
    notifier,
    paper,
    macro,
    lab,
    experiments,
    scanner,
    mt5,
    fundamentals,
  };
}
