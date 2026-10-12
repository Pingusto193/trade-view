import { randomUUID } from 'node:crypto';
import type {
  Channel,
  DeliveryResult,
  NotifySettings,
  NotifySettingsInput,
  PushSubscriptionInput,
} from '@radar/shared';
import { and, eq } from 'drizzle-orm';
import type { SecretBox } from '../auth/crypto';
import type { Db } from '../db/client';
import { notifySettings, pushSubscriptions } from '../db/schema';
import type { EmailSender, PushSender, TelegramSender } from './channels';
import { isQuiet } from './quiet';

export interface Message {
  title: string;
  body: string;
  /** Link absoluto para abrir o gráfico no estado certo. */
  url: string;
  /** Mesma tag = a notificação nova substitui a anterior no aparelho. */
  tag?: string;
}

export interface Senders {
  push: PushSender;
  telegram: TelegramSender;
  email: EmailSender;
}

/** Fuso de exibição do app (SPEC §3: America/Sao_Paulo). */
export const DISPLAY_TZ = 'America/Sao_Paulo';

/**
 * Entrega mensagens pelos canais escolhidos (SPEC §10): Web Push, Telegram do próprio usuário e
 * e-mail. Respeita o horário de silêncio e remove assinaturas de push que o aparelho cancelou.
 */
export class Notifier {
  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly senders: Senders,
    private readonly vapidPublicKey: string,
    private readonly now: () => number = Date.now,
  ) {}

  private row(userId: number) {
    return this.db.select().from(notifySettings).where(eq(notifySettings.userId, userId)).get();
  }

  settings(userId: number): NotifySettings {
    const r = this.row(userId);
    const devices = this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .all();
    return {
      quietEnabled: r?.quietEnabled ?? false,
      quietStart: r?.quietStart ?? '22:00',
      quietEnd: r?.quietEnd ?? '07:00',
      telegramConfigured: Boolean(r?.telegramTokenEnc),
      telegramChatId: r?.telegramChatId ?? null,
      email: r?.email ?? null,
      emailAvailable: this.senders.email.available,
      vapidPublicKey: this.vapidPublicKey,
      pushDevices: devices.map((d) => ({
        id: d.id,
        label: d.label,
        createdAt: d.createdAt,
        lastOkAt: d.lastOkAt,
      })),
    };
  }

  saveSettings(userId: number, input: NotifySettingsInput): NotifySettings {
    const cur = this.row(userId);
    const next = {
      userId,
      quietEnabled: input.quietEnabled,
      quietStart: input.quietStart,
      quietEnd: input.quietEnd,
      // undefined = manter; null = apagar
      telegramTokenEnc:
        input.telegramToken === undefined
          ? (cur?.telegramTokenEnc ?? null)
          : input.telegramToken === null
            ? null
            : this.box.seal(input.telegramToken),
      telegramChatId:
        input.telegramChatId === undefined ? (cur?.telegramChatId ?? null) : input.telegramChatId,
      email: input.email === undefined ? (cur?.email ?? null) : input.email,
      updatedAt: this.now(),
    };
    this.db
      .insert(notifySettings)
      .values(next)
      .onConflictDoUpdate({ target: notifySettings.userId, set: next })
      .run();
    return this.settings(userId);
  }

  telegramToken(userId: number): string | null {
    const enc = this.row(userId)?.telegramTokenEnc;
    return enc ? this.box.open(enc) : null;
  }

  async detectTelegramChat(userId: number): Promise<{ chatId: string; name: string } | null> {
    const token = this.telegramToken(userId);
    if (!token) throw new Error('Salve primeiro o token do bot');
    return this.senders.telegram.detectChat(token);
  }

  addPush(userId: number, sub: PushSubscriptionInput): string {
    // o mesmo navegador assinando de novo substitui a assinatura antiga
    this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint)).run();
    const id = randomUUID();
    this.db
      .insert(pushSubscriptions)
      .values({
        id,
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        label: sub.label,
        createdAt: this.now(),
      })
      .run();
    return id;
  }

  removePush(userId: number, id: string): boolean {
    const r = this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.id, id)))
      .run();
    return r.changes > 0;
  }

  /** Está no horário de silêncio do usuário? */
  quiet(userId: number, at = this.now()): boolean {
    const r = this.row(userId);
    return Boolean(r?.quietEnabled && isQuiet(at, r.quietStart, r.quietEnd, DISPLAY_TZ));
  }

  /**
   * Entrega a mensagem. No silêncio, nada é enviado (o disparo fica no histórico como "silenciado").
   * Retorna o resultado por canal: "ok", "silenciado" ou o motivo do erro.
   */
  async deliver(
    userId: number,
    msg: Message,
    channels: readonly Channel[],
    opts: { ignoreQuiet?: boolean } = {},
  ): Promise<{ delivery: DeliveryResult; silenced: boolean }> {
    const delivery: DeliveryResult = {};
    if (!opts.ignoreQuiet && this.quiet(userId)) {
      for (const ch of channels) delivery[ch] = 'silenciado';
      return { delivery, silenced: true };
    }
    await Promise.all(
      [...new Set(channels)].map(async (ch) => {
        try {
          delivery[ch] = await this.sendOne(userId, ch, msg);
        } catch (err) {
          delivery[ch] = `erro: ${(err as Error).message}`;
        }
      }),
    );
    return { delivery, silenced: false };
  }

  private async sendOne(userId: number, ch: Channel, msg: Message): Promise<string> {
    if (ch === 'push') {
      const subs = this.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .all();
      if (subs.length === 0) return 'erro: nenhum aparelho ativado';
      const payload = JSON.stringify({
        title: msg.title,
        body: msg.body,
        url: msg.url,
        ...(msg.tag ? { tag: msg.tag } : {}),
      });
      let ok = 0;
      const errors: string[] = [];
      for (const s of subs) {
        const r = await this.senders.push.send(s, payload);
        if (r.ok) {
          ok++;
          this.db
            .update(pushSubscriptions)
            .set({ lastOkAt: this.now(), failCount: 0 })
            .where(eq(pushSubscriptions.id, s.id))
            .run();
        } else if (r.gone || s.failCount >= 9) {
          this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).run();
          errors.push(`${s.label}: assinatura expirada (removida)`);
        } else {
          this.db
            .update(pushSubscriptions)
            .set({ failCount: s.failCount + 1 })
            .where(eq(pushSubscriptions.id, s.id))
            .run();
          errors.push(`${s.label}: ${r.message}`);
        }
      }
      if (ok === subs.length) return 'ok';
      return ok > 0
        ? `ok em ${ok} de ${subs.length} (${errors.join('; ')})`
        : `erro: ${errors.join('; ')}`;
    }
    if (ch === 'telegram') {
      const token = this.telegramToken(userId);
      const chat = this.row(userId)?.telegramChatId;
      if (!token || !chat) return 'erro: Telegram não configurado';
      await this.senders.telegram.send(token, chat, `${msg.title}\n${msg.body}\n${msg.url}`);
      return 'ok';
    }
    const to = this.row(userId)?.email;
    if (!this.senders.email.available) return 'erro: SMTP não configurado no servidor';
    if (!to) return 'erro: e-mail não informado';
    await this.senders.email.send(to, msg.title, `${msg.body}\n\nAbrir no Radar: ${msg.url}`);
    return 'ok';
  }
}
