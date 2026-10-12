import {
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
  type Timeframe,
} from '@radar/shared';

type Handler = (msg: ServerMessage) => void;
export type SyncMessage = Extract<ServerMessage, { type: 'sync' }>;

/**
 * Cliente WebSocket único do app. Reconecta sozinho e refaz as assinaturas.
 * O navegador fala só com o servidor do Radar; as fontes de dados ficam do lado de lá.
 */
class MarketSocket {
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly syncHandlers = new Set<(m: SyncMessage) => void>();
  private attempt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connectedListeners = new Set<(up: boolean) => void>();
  connected = false;

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  private ensure(): void {
    if (this.ws && this.ws.readyState <= 1) return;
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setConnected(true);
      for (const key of this.handlers.keys()) {
        const [id, tf] = key.split('|') as [string, Timeframe];
        this.send({ type: 'subscribe', id, tf });
      }
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25_000);
    };
    ws.onmessage = (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const parsed = serverMessageSchema.safeParse(data);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === 'candle' || msg.type === 'status') {
        for (const h of this.handlers.get(`${msg.id}|${msg.tf}`) ?? []) h(msg);
      } else if (msg.type === 'sync') {
        for (const h of this.syncHandlers) h(msg);
      } else if (msg.type === 'error') {
        console.warn('Radar WS:', msg.message);
      }
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.setConnected(false);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.handlers.size === 0) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt++);
      setTimeout(() => this.ensure(), delay);
    };
  }

  private setConnected(up: boolean) {
    this.connected = up;
    for (const l of this.connectedListeners) l(up);
  }

  /** Avisos de mudança feita em outro aparelho. */
  onSync(fn: (m: SyncMessage) => void): () => void {
    this.syncHandlers.add(fn);
    return () => this.syncHandlers.delete(fn);
  }

  onConnectionChange(fn: (up: boolean) => void): () => void {
    this.connectedListeners.add(fn);
    return () => this.connectedListeners.delete(fn);
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  subscribe(id: string, tf: Timeframe, handler: Handler): () => void {
    const key = `${id}|${tf}`;
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
      this.send({ type: 'subscribe', id, tf });
    }
    set.add(handler);
    this.ensure();
    return () => {
      set?.delete(handler);
      if (set && set.size === 0) {
        this.handlers.delete(key);
        this.send({ type: 'unsubscribe', id, tf });
      }
    };
  }
}

export const marketSocket = new MarketSocket();
