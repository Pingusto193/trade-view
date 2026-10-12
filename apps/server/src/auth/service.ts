import { hash, verify } from '@node-rs/argon2';
import { and, count, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { invites, loginAttempts, sessions, users } from '../db/schema';
import type { SecretBox } from './crypto';
import { randomToken, sha256, verifyTotp } from './crypto';

/** Parâmetros do argon2id: mínimo recomendado pela OWASP (19 MiB, t=2, p=1). */
const ARGON = {
  algorithm: 2 /* Argon2id (const enum da lib) */,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const SESSION_DAYS = 30;
const DAY = 86_400_000;
/** Proteção contra força bruta: até 5 falhas em 15 min por chave; depois, espera crescente. */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;

export interface PublicUser {
  id: number;
  email: string;
  totpEnabled: boolean;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (pw.length > 200) return 'Senha longa demais.';
  if (/^(.)\1+$/.test(pw)) return 'A senha não pode ser um caractere repetido.';
  return null;
}

export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly now: () => number = Date.now,
  ) {}

  userCount(): number {
    return this.db.select({ n: count() }).from(users).get()?.n ?? 0;
  }

  private toPublic(u: typeof users.$inferSelect): PublicUser {
    return { id: u.id, email: u.email, totpEnabled: u.totpEnabled };
  }

  // ---------------------------------------------------------------- força bruta

  private recentFails(key: string): number {
    const since = this.now() - WINDOW_MS;
    return (
      this.db
        .select({ n: count() })
        .from(loginAttempts)
        .where(
          and(eq(loginAttempts.key, key), gt(loginAttempts.at, since), eq(loginAttempts.ok, false)),
        )
        .get()?.n ?? 0
    );
  }

  /** Lança AuthError 429 se a chave estiver bloqueada. */
  assertNotBlocked(keys: string[]): void {
    for (const k of keys) {
      const fails = this.recentFails(k);
      if (fails >= MAX_FAILS) {
        const wait = Math.min(60, 2 ** (fails - MAX_FAILS)) * 60_000;
        const last =
          this.db
            .select({ at: loginAttempts.at })
            .from(loginAttempts)
            .where(and(eq(loginAttempts.key, k), eq(loginAttempts.ok, false)))
            .orderBy(loginAttempts.at)
            .all()
            .at(-1)?.at ?? 0;
        const retry = last + wait - this.now();
        if (retry > 0) {
          throw new AuthError(
            `Muitas tentativas erradas. Tente de novo em ${Math.ceil(retry / 60_000)} min.`,
            429,
            retry,
          );
        }
      }
    }
  }

  private record(keys: string[], ok: boolean): void {
    const at = this.now();
    for (const key of keys) this.db.insert(loginAttempts).values({ key, at, ok }).run();
    // limpeza simples de registros antigos
    this.db
      .delete(loginAttempts)
      .where(lt(loginAttempts.at, at - 7 * DAY))
      .run();
  }

  // ---------------------------------------------------------------- cadastro e login

  /** Primeira conta: livre. Depois: só com convite válido (SPEC §17 — cadastro fechado). */
  async register(emailRaw: string, password: string, inviteToken?: string): Promise<PublicUser> {
    const email = normalizeEmail(emailRaw);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError('E-mail inválido.', 400);
    const pwErr = validatePassword(password);
    if (pwErr) throw new AuthError(pwErr, 400);

    let inviteHash: string | null = null;
    if (this.userCount() > 0) {
      if (!inviteToken)
        throw new AuthError('Cadastro fechado. Peça um convite ao dono do Radar.', 403);
      inviteHash = sha256(inviteToken);
      const inv = this.db.select().from(invites).where(eq(invites.tokenHash, inviteHash)).get();
      if (!inv || inv.usedAt || inv.expiresAt < this.now()) {
        throw new AuthError('Convite inválido ou expirado.', 403);
      }
    }
    if (this.db.select().from(users).where(eq(users.email, email)).get()) {
      throw new AuthError('Este e-mail já tem conta.', 409);
    }
    const passwordHash = await hash(password, ARGON);
    const row = this.db
      .insert(users)
      .values({ email, passwordHash, createdAt: this.now() })
      .returning()
      .get();
    if (inviteHash) {
      this.db
        .update(invites)
        .set({ usedAt: this.now() })
        .where(eq(invites.tokenHash, inviteHash))
        .run();
    }
    return this.toPublic(row);
  }

  /**
   * Verifica e-mail, senha e (se ligado) o código do 2FA.
   * Retorna `needTotp` quando a senha está certa mas falta o código.
   */
  async login(
    emailRaw: string,
    password: string,
    totpCode: string | undefined,
    ip: string,
  ): Promise<{ user: PublicUser } | { needTotp: true }> {
    const email = normalizeEmail(emailRaw);
    const keys = [`ip:${ip}`, `email:${email}`];
    this.assertNotBlocked(keys);
    const u = this.db.select().from(users).where(eq(users.email, email)).get();
    // Sempre roda o argon2 (mesmo sem usuário) para não revelar pelo tempo quais e-mails existem.
    this.dummyHash ??= hash(randomToken(), ARGON);
    const ok = u
      ? await verify(u.passwordHash, password)
      : (await verify(await this.dummyHash, password), false);
    if (!u || !ok) {
      this.record(keys, false);
      throw new AuthError('E-mail ou senha incorretos.', 401);
    }
    if (u.totpEnabled) {
      if (!totpCode) return { needTotp: true };
      const secret = u.totpSecret ? this.box.open(u.totpSecret) : '';
      if (!verifyTotp(secret, totpCode.trim(), this.now())) {
        this.record(keys, false);
        throw new AuthError('Código do autenticador incorreto.', 401);
      }
    }
    this.record(keys, true);
    return { user: this.toPublic(u) };
  }

  // ---------------------------------------------------------------- sessões

  createSession(
    userId: number,
    userAgent: string | undefined,
  ): { token: string; expiresAt: number } {
    const token = randomToken(32);
    const now = this.now();
    const expiresAt = now + SESSION_DAYS * DAY;
    this.db
      .insert(sessions)
      .values({
        id: sha256(token),
        userId,
        createdAt: now,
        expiresAt,
        userAgent: userAgent?.slice(0, 200) ?? null,
      })
      .run();
    return { token, expiresAt };
  }

  /** Valida o token do cookie; renova a validade (sessão deslizante). */
  userFromToken(token: string | undefined): PublicUser | null {
    if (!token || token.length > 100) return null;
    const id = sha256(token);
    const row = this.db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, id))
      .get();
    if (!row) return null;
    const now = this.now();
    if (row.s.expiresAt < now) {
      this.db.delete(sessions).where(eq(sessions.id, id)).run();
      return null;
    }
    if (row.s.expiresAt - now < (SESSION_DAYS - 1) * DAY) {
      this.db
        .update(sessions)
        .set({ expiresAt: now + SESSION_DAYS * DAY })
        .where(eq(sessions.id, id))
        .run();
    }
    return this.toPublic(row.u);
  }

  logout(token: string | undefined): void {
    if (token)
      this.db
        .delete(sessions)
        .where(eq(sessions.id, sha256(token)))
        .run();
  }

  logoutAll(userId: number): void {
    this.db.delete(sessions).where(eq(sessions.userId, userId)).run();
  }

  // ---------------------------------------------------------------- conta

  async changePassword(userId: number, current: string, next: string): Promise<void> {
    const u = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!u || !(await verify(u.passwordHash, current)))
      throw new AuthError('Senha atual incorreta.', 401);
    const err = validatePassword(next);
    if (err) throw new AuthError(err, 400);
    this.db
      .update(users)
      .set({ passwordHash: await hash(next, ARGON) })
      .where(eq(users.id, userId))
      .run();
  }

  /** Guarda um segredo TOTP pendente (ainda não ligado) e o devolve para o QR. */
  startTotp(userId: number, secret: string): void {
    this.db
      .update(users)
      .set({ totpSecret: this.box.seal(secret), totpEnabled: false })
      .where(eq(users.id, userId))
      .run();
  }

  confirmTotp(userId: number, code: string): void {
    const u = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!u?.totpSecret) throw new AuthError('Comece a configuração do 2FA de novo.', 400);
    if (!verifyTotp(this.box.open(u.totpSecret), code.trim(), this.now())) {
      throw new AuthError('Código incorreto. Confira o horário do celular e tente de novo.', 400);
    }
    this.db.update(users).set({ totpEnabled: true }).where(eq(users.id, userId)).run();
  }

  async disableTotp(userId: number, password: string): Promise<void> {
    const u = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!u || !(await verify(u.passwordHash, password)))
      throw new AuthError('Senha incorreta.', 401);
    this.db
      .update(users)
      .set({ totpEnabled: false, totpSecret: null })
      .where(eq(users.id, userId))
      .run();
  }

  /** Modo de desenvolvimento sem login: garante um usuário local para os dados por usuário. */
  async ensureDevUser(): Promise<PublicUser> {
    const u = this.db.select().from(users).orderBy(users.id).get();
    if (u) return this.toPublic(u);
    const row = this.db
      .insert(users)
      .values({
        email: 'dev@local',
        passwordHash: await hash(randomToken(), ARGON),
        createdAt: this.now(),
      })
      .returning()
      .get();
    return this.toPublic(row);
  }

  createInvite(userId: number, days = 7): string {
    const token = randomToken(24);
    this.db
      .insert(invites)
      .values({
        tokenHash: sha256(token),
        createdBy: userId,
        createdAt: this.now(),
        expiresAt: this.now() + days * DAY,
      })
      .run();
    return token;
  }
}
