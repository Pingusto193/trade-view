import { afterEach, describe, expect, it } from 'vitest';
import { SecretBox, base32Decode, base32Encode, hotp, totp, verifyTotp } from '../src/auth/crypto';
import { testApp } from './helpers';

describe('TOTP (RFC 6238, vetores oficiais SHA-1)', () => {
  const key = Buffer.from('12345678901234567890');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('T=%i → %s', (t, code) => {
    expect(hotp(key, Math.floor(t / 30), 8)).toBe(code);
  });

  it('base32 ida e volta', () => {
    const b = Buffer.from('olá, radar!');
    expect(base32Decode(base32Encode(b)).toString()).toBe('olá, radar!');
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('aceita ±1 passo de 30 s e recusa códigos malformados', () => {
    const secret = base32Encode(key);
    const now = 1_700_000_000_000;
    const code = totp(key, now - 30_000);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, totp(key, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, '12a456', now)).toBe(false);
  });
});

describe('cofre de segredos (AES-256-GCM)', () => {
  it('cifra, decifra e detecta adulteração', () => {
    const box = SecretBox.load(undefined, null);
    const sealed = box.seal('segredo');
    expect(sealed).not.toContain('segredo');
    expect(box.open(sealed)).toBe('segredo');
    const raw = Buffer.from(sealed, 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] as number) ^ 1;
    expect(() => box.open(raw.toString('base64'))).toThrow();
  });
});

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const json = { 'content-type': 'application/json' };
const PW = 'senha-bem-longa-123';

async function authApp(now?: () => number) {
  const t = await testApp({ auth: true, ...(now ? { now } : {}) });
  close = () => t.app.close();
  const post = (url: string, body: unknown, cookie?: string, origin?: string) =>
    t.app.inject({
      method: 'POST',
      url,
      headers: { ...json, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
      payload: JSON.stringify(body),
    });
  const cookieOf = (r: { cookies: { name: string; value: string }[] }) => {
    const c = r.cookies.find((x) => x.name === 'radar_sid');
    return c ? `radar_sid=${c.value}` : '';
  };
  return { t, post, cookieOf };
}

describe('contas e sessões', () => {
  it('primeiro acesso cria conta; depois o cadastro fica fechado (só com convite)', async () => {
    const { t, post, cookieOf } = await authApp();
    expect((await t.app.inject({ url: '/api/auth/state' })).json()).toMatchObject({
      needsSetup: true,
      user: null,
    });

    const r1 = await post('/api/auth/register', { email: 'Eu@Exemplo.com', password: PW });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().user.email).toBe('eu@exemplo.com');
    const c = cookieOf(r1);
    const ck = r1.cookies.find((x) => x.name === 'radar_sid');
    expect(ck?.httpOnly).toBe(true);
    expect(ck?.sameSite).toBe('Lax');

    const r2 = await post('/api/auth/register', { email: 'outro@exemplo.com', password: PW });
    expect(r2.statusCode).toBe(403);

    const inv = (await post('/api/auth/invites', {}, c)).json();
    const token = new URL(inv.url).searchParams.get('token');
    const r3 = await post('/api/auth/register', {
      email: 'outro@exemplo.com',
      password: PW,
      invite: token,
    });
    expect(r3.statusCode).toBe(200);
    // convite só vale uma vez
    const r4 = await post('/api/auth/register', {
      email: 'terceiro@exemplo.com',
      password: PW,
      invite: token,
    });
    expect(r4.statusCode).toBe(403);
  });

  it('senha fraca é recusada', async () => {
    const { post } = await authApp();
    expect(
      (await post('/api/auth/register', { email: 'a@b.com', password: 'curta' })).statusCode,
    ).toBe(400);
  });

  it('rotas de dados exigem login (API e WebSocket)', async () => {
    const { t, post, cookieOf } = await authApp();
    expect((await t.app.inject({ url: '/api/sources' })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/api/health' })).statusCode).toBe(200);
    const c = cookieOf(await post('/api/auth/register', { email: 'a@b.com', password: PW }));
    expect((await t.app.inject({ url: '/api/sources', headers: { cookie: c } })).statusCode).toBe(
      200,
    );
    expect(
      (await t.app.inject({ url: '/api/sources', headers: { cookie: 'radar_sid=forjado' } }))
        .statusCode,
    ).toBe(401);
    await t.app.ready();
    await expect(t.app.injectWS('/ws')).rejects.toThrow(/401/);
  });

  it('logout invalida a sessão', async () => {
    const { t, post, cookieOf } = await authApp();
    const c = cookieOf(await post('/api/auth/register', { email: 'a@b.com', password: PW }));
    await post('/api/auth/logout', {}, c);
    expect((await t.app.inject({ url: '/api/sources', headers: { cookie: c } })).statusCode).toBe(
      401,
    );
  });

  it('força bruta: após 5 erros, bloqueia mesmo com a senha certa', async () => {
    const { post } = await authApp();
    await post('/api/auth/register', { email: 'a@b.com', password: PW });
    for (let i = 0; i < 5; i++) {
      expect(
        (await post('/api/auth/login', { email: 'a@b.com', password: 'errada-errada' })).statusCode,
      ).toBe(401);
    }
    const blocked = await post('/api/auth/login', { email: 'a@b.com', password: PW });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('e-mail inexistente dá a mesma mensagem de senha errada', async () => {
    const { post } = await authApp();
    await post('/api/auth/register', { email: 'a@b.com', password: PW });
    const r = await post('/api/auth/login', { email: 'nao@existe.com', password: PW });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('E-mail ou senha incorretos.');
  });

  it('2FA: liga com código válido e passa a exigir o código no login', async () => {
    let now = 1_800_000_000_000;
    const { post, cookieOf } = await authApp(() => now);
    const c = cookieOf(await post('/api/auth/register', { email: 'a@b.com', password: PW }));
    const start = (await post('/api/auth/totp/start', {}, c)).json();
    expect(start.uri).toMatch(/^otpauth:\/\/totp\/Radar%3Aa%40b\.com\?secret=/);
    expect(start.svg).toContain('<svg');
    const key = base32Decode(start.secret);
    expect((await post('/api/auth/totp/confirm', { code: '000000' }, c)).statusCode).toBe(400);
    expect((await post('/api/auth/totp/confirm', { code: totp(key, now) }, c)).statusCode).toBe(
      200,
    );

    const step1 = (await post('/api/auth/login', { email: 'a@b.com', password: PW })).json();
    expect(step1).toEqual({ needTotp: true });
    now += 60_000;
    const ok = await post('/api/auth/login', {
      email: 'a@b.com',
      password: PW,
      totp: totp(key, now),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.totpEnabled).toBe(true);
  });

  it('CSRF: POST vindo de outra origem é recusado', async () => {
    const { post, cookieOf } = await authApp();
    const c = cookieOf(await post('/api/auth/register', { email: 'a@b.com', password: PW }));
    expect((await post('/api/auth/invites', {}, c, 'https://site-malicioso.com')).statusCode).toBe(
      403,
    );
    expect((await post('/api/auth/invites', {}, c, 'http://localhost:5173')).statusCode).toBe(200);
  });

  it('trocar senha exige a senha atual', async () => {
    const { post, cookieOf } = await authApp();
    const c = cookieOf(await post('/api/auth/register', { email: 'a@b.com', password: PW }));
    expect(
      (await post('/api/auth/password', { current: 'errada', next: 'nova-senha-longa-1' }, c))
        .statusCode,
    ).toBe(401);
    expect(
      (await post('/api/auth/password', { current: PW, next: 'nova-senha-longa-1' }, c)).statusCode,
    ).toBe(200);
    expect(
      (await post('/api/auth/login', { email: 'a@b.com', password: 'nova-senha-longa-1' }))
        .statusCode,
    ).toBe(200);
  });
});
