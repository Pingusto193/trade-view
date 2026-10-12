import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { renderSVG } from 'uqr';
import { z } from 'zod';
import { newTotpSecret, otpauthUri } from '../auth/crypto';
import { AuthError, SESSION_DAYS, type AuthService, type PublicUser } from '../auth/service';
import type { Env } from '../env';

export const SESSION_COOKIE = 'radar_sid';

declare module 'fastify' {
  interface FastifyRequest {
    user: PublicUser | null;
  }
}

const credentials = z.object({
  email: z.string().max(200),
  password: z.string().max(200),
});

export function authRoutes(app: FastifyInstance, auth: AuthService, env: Env) {
  const secure = env.PUBLIC_URL.startsWith('https://');
  const setSession = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: SESSION_DAYS * 86_400,
    });
  const requireUser = (req: FastifyRequest): PublicUser => {
    if (!req.user) throw new AuthError('Faça login.', 401);
    return req.user;
  };
  const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.get('/api/auth/state', async (req) => ({
    needsSetup: auth.userCount() === 0 && !env.RADAR_DEV_NO_AUTH,
    devNoAuth: env.RADAR_DEV_NO_AUTH,
    user: req.user,
  }));

  app.post('/api/auth/register', strict, async (req, reply) => {
    const b = credentials.extend({ invite: z.string().max(100).optional() }).parse(req.body);
    const user = await auth.register(b.email, b.password, b.invite);
    const s = auth.createSession(user.id, req.headers['user-agent']);
    setSession(reply, s.token);
    return { user };
  });

  app.post('/api/auth/login', strict, async (req, reply) => {
    const b = credentials.extend({ totp: z.string().max(10).optional() }).parse(req.body);
    const r = await auth.login(b.email, b.password, b.totp, req.ip ?? 'desconhecido');
    if ('needTotp' in r) return { needTotp: true };
    const s = auth.createSession(r.user.id, req.headers['user-agent']);
    setSession(reply, s.token);
    return { user: r.user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    auth.logout(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/logout-all', async (req, reply) => {
    const u = requireUser(req);
    auth.logoutAll(u.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', strict, async (req) => {
    const u = requireUser(req);
    const b = z.object({ current: z.string().max(200), next: z.string().max(200) }).parse(req.body);
    await auth.changePassword(u.id, b.current, b.next);
    return { ok: true };
  });

  app.post('/api/auth/totp/start', async (req) => {
    const u = requireUser(req);
    const secret = newTotpSecret();
    auth.startTotp(u.id, secret);
    const uri = otpauthUri(secret, u.email);
    return { secret, uri, svg: renderSVG(uri) };
  });

  app.post('/api/auth/totp/confirm', strict, async (req) => {
    const u = requireUser(req);
    const b = z.object({ code: z.string().max(10) }).parse(req.body);
    auth.confirmTotp(u.id, b.code);
    return { ok: true };
  });

  app.post('/api/auth/totp/disable', strict, async (req) => {
    const u = requireUser(req);
    const b = z.object({ password: z.string().max(200) }).parse(req.body);
    await auth.disableTotp(u.id, b.password);
    return { ok: true };
  });

  app.post('/api/auth/invites', async (req) => {
    const u = requireUser(req);
    const token = auth.createInvite(u.id);
    return { url: `${env.PUBLIC_URL.replace(/\/$/, '')}/convite?token=${token}`, expiresInDays: 7 };
  });
}

/**
 * Proteção das rotas: tudo em /api e /ws exige login, exceto saúde e autenticação.
 * Também barra requisições que mudam dados vindas de outra origem (CSRF).
 */
export function installAuthGuard(app: FastifyInstance, auth: AuthService, env: Env) {
  app.decorateRequest('user', null);
  let devUser: PublicUser | null = null;
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url;
    const isApi = url.startsWith('/api/') || url === '/ws' || url.startsWith('/ws?');
    if (!isApi) return;

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const origin = req.headers.origin;
      if (origin) {
        const allowed = new Set([
          new URL(env.PUBLIC_URL).origin,
          `http://${req.headers.host}`,
          `https://${req.headers.host}`,
        ]);
        if (!allowed.has(origin)) return reply.code(403).send({ error: 'origem não permitida' });
      }
    }

    if (env.RADAR_DEV_NO_AUTH) {
      devUser ??= await auth.ensureDevUser();
      req.user = devUser;
      return;
    }
    req.user = auth.userFromToken(req.cookies[SESSION_COOKIE]);
    if (url.startsWith('/api/health') || url.startsWith('/api/auth/')) return;
    if (!req.user) return reply.code(401).send({ error: 'Faça login para continuar.' });
  });
}
