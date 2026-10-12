import { api } from './api';

/** O que este navegador permite em notificações (SPEC §10: iPhone só com o app instalado). */
export interface PushSupport {
  supported: boolean;
  ios: boolean;
  /** Versão do iOS/iPadOS (ex.: 17.4) ou null se não for iPhone/iPad. */
  iosVersion: number | null;
  /** Aberto como app instalado (Tela de Início / janela própria)? */
  standalone: boolean;
  permission: NotificationPermission | 'unsupported';
}

export function pushSupport(): PushSupport {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const m = /OS (\d+)[_.](\d+)/.exec(ua);
  const iosVersion = ios && m ? Number(`${m[1]}.${m[2]}`) : null;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return {
    supported,
    ios,
    iosVersion,
    standalone,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
  };
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Computador (Windows)';
  if (/Mac/.test(ua)) return 'Computador (Mac)';
  return 'Navegador';
}

/**
 * Pede permissão e assina o push. PRECISA ser chamado direto do toque do usuário (exigência do iPhone).
 */
export async function enablePush(vapidPublicKey: string): Promise<string> {
  const s = pushSupport();
  if (!s.supported) throw new Error('Este navegador não suporta notificações push.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted')
    throw new Error('Permissão negada. Libere nas configurações do aparelho.');
  // em desenvolvimento o service worker não é registrado: não fica esperando para sempre
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, rej) =>
      setTimeout(
        () =>
          rej(
            new Error(
              'Notificações só funcionam no app publicado (não no modo de desenvolvimento).',
            ),
          ),
        8000,
      ),
    ),
  ]);
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(vapidPublicKey),
    }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const r = await api<{ id: string }>('/api/notify/push', {
    method: 'POST',
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, label: deviceLabel() }),
  });
  return r.id;
}
