import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import webpush from 'web-push';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * Chaves VAPID do Web Push: do .env, ou geradas uma única vez e guardadas num arquivo ao lado do
 * banco (trocar as chaves invalida as assinaturas de todos os aparelhos).
 */
export function loadVapid(
  env: { VAPID_PUBLIC_KEY?: string | undefined; VAPID_PRIVATE_KEY?: string | undefined },
  file: string | null,
): VapidKeys {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  }
  if (file && existsSync(file)) {
    const k = JSON.parse(readFileSync(file, 'utf8')) as VapidKeys;
    if (k.publicKey && k.privateKey) return k;
  }
  const k = webpush.generateVAPIDKeys();
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(k), { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      // sistemas sem permissões POSIX
    }
  }
  return k;
}
