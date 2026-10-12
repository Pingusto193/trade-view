import { createTransport } from 'nodemailer';
import webpush from 'web-push';
import type { VapidKeys } from './vapid';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult = { ok: true } | { ok: false; gone: boolean; message: string };

export interface PushSender {
  send(target: PushTarget, payload: string): Promise<PushResult>;
}

export interface TelegramSender {
  send(token: string, chatId: string, text: string): Promise<void>;
  /** Descobre o chat de quem mandou /start para o bot por último. */
  detectChat(token: string): Promise<{ chatId: string; name: string } | null>;
}

export interface EmailSender {
  readonly available: boolean;
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Web Push com chaves VAPID (biblioteca web-push). */
export class WebPushSender implements PushSender {
  constructor(
    private readonly keys: VapidKeys,
    private readonly subject: string,
  ) {}

  async send(t: PushTarget, payload: string): Promise<PushResult> {
    try {
      await webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        payload,
        {
          vapidDetails: {
            subject: this.subject,
            publicKey: this.keys.publicKey,
            privateKey: this.keys.privateKey,
          },
          TTL: 3600,
          urgency: 'high',
          timeout: 10_000,
        },
      );
      return { ok: true };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410 = assinatura expirada ou cancelada no aparelho: apagar
      return {
        ok: false,
        gone: status === 404 || status === 410,
        message: status ? `serviço de push respondeu ${status}` : (err as Error).message,
      };
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Telegram Bot API por HTTPS. No máximo 1 mensagem por segundo por chat e respeita `retry_after`
 * (DATA_SOURCES §13).
 */
export class TelegramHttp implements TelegramSender {
  private readonly lastSent = new Map<string, number>();

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly base = 'https://api.telegram.org',
  ) {}

  private async call(token: string, method: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.fetchFn(`${this.base}/bot${token}/${method}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: unknown;
        description?: string;
        parameters?: { retry_after?: number };
      };
      if (res.status === 429 && attempt === 0) {
        const wait = Math.min(json.parameters?.retry_after ?? 1, 30);
        await sleep(wait * 1000);
        continue;
      }
      if (!res.ok || !json.ok) {
        // nunca repassa o token em mensagens de erro
        throw new Error(`Telegram recusou (${res.status}): ${json.description ?? 'sem detalhe'}`);
      }
      return json.result;
    }
    throw new Error('Telegram: muitas mensagens, tente mais tarde');
  }

  async send(token: string, chatId: string, text: string): Promise<void> {
    const last = this.lastSent.get(chatId) ?? 0;
    const wait = last + 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastSent.set(chatId, Date.now());
    await this.call(token, 'sendMessage', { chat_id: chatId, text: text.slice(0, 4000) });
  }

  async detectChat(token: string): Promise<{ chatId: string; name: string } | null> {
    const updates = (await this.call(token, 'getUpdates')) as {
      message?: { chat?: { id?: number; first_name?: string; title?: string; username?: string } };
    }[];
    for (let i = updates.length - 1; i >= 0; i--) {
      const chat = updates[i]?.message?.chat;
      if (chat?.id !== undefined) {
        return {
          chatId: String(chat.id),
          name: chat.first_name ?? chat.title ?? chat.username ?? 'chat',
        };
      }
    }
    return null;
  }
}

/** E-mail por SMTP (nodemailer). Sem SMTP_HOST no .env, o canal fica indisponível. */
export class SmtpEmail implements EmailSender {
  private readonly transport: ReturnType<typeof createTransport> | null;
  readonly available: boolean;

  constructor(
    private readonly cfg: {
      host?: string | undefined;
      port: number;
      secure: boolean;
      user?: string | undefined;
      pass?: string | undefined;
      from?: string | undefined;
    },
  ) {
    this.available = Boolean(cfg.host);
    this.transport = cfg.host
      ? createTransport({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass ?? '' } } : {}),
        })
      : null;
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transport) throw new Error('SMTP não configurado no servidor');
    await this.transport.sendMail({
      from: this.cfg.from ?? this.cfg.user ?? 'radar@localhost',
      to,
      subject,
      text,
    });
  }
}
