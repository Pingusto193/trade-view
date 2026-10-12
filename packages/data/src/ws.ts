/**
 * Conexão WebSocket com reconexão automática e backoff exponencial.
 * Usa o WebSocket global (Node ≥ 22 e navegadores); a fábrica é injetável para testes.
 */
export interface WsLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WsFactory = (url: string) => WsLike;

export const defaultWsFactory: WsFactory = (url) => new WebSocket(url) as unknown as WsLike;

export interface ReconnectingWsOptions {
  url: string;
  factory?: WsFactory;
  onOpen?(ws: WsLike, reconnected: boolean): void;
  onMessage(data: string): void;
  onDown?(reason: string): void;
  /** Reconecta preventivamente após este tempo (Binance derruba em 24 h). */
  maxLifetimeMs?: number;
  /** Considera a conexão "parada" se não houver mensagem neste intervalo. */
  staleAfterMs?: number;
  onStale?(): void;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class ReconnectingWs {
  private ws: WsLike | null = null;
  private closed = false;
  private attempt = 0;
  private everOpened = false;
  private lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: ReconnectingWsOptions) {
    this.connect();
  }

  send(data: string): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(data);
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    this.ws?.close(1000, 'fechado pelo Radar');
    this.ws = null;
  }

  private clearTimers(): void {
    if (this.lifetimeTimer) clearTimeout(this.lifetimeTimer);
    if (this.staleTimer) clearTimeout(this.staleTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.lifetimeTimer = this.staleTimer = this.reconnectTimer = null;
  }

  private armStale(): void {
    if (!this.opts.staleAfterMs) return;
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => this.opts.onStale?.(), this.opts.staleAfterMs);
  }

  private connect(): void {
    if (this.closed) return;
    const factory = this.opts.factory ?? defaultWsFactory;
    let ws: WsLike;
    try {
      ws = factory(this.opts.url);
    } catch (err) {
      this.scheduleReconnect(`erro ao abrir: ${(err as Error).message}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      const reconnected = this.everOpened;
      this.everOpened = true;
      this.armStale();
      if (this.opts.maxLifetimeMs) {
        this.lifetimeTimer = setTimeout(() => {
          ws.close(1000, 'renovação preventiva');
        }, this.opts.maxLifetimeMs);
      }
      this.opts.onOpen?.(ws, reconnected);
    };
    ws.onmessage = (ev) => {
      this.armStale();
      const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
      this.opts.onMessage(data);
    };
    ws.onerror = () => {
      // o onclose sempre vem em seguida; a reconexão é tratada lá
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      this.scheduleReconnect('conexão encerrada');
    };
  }

  private scheduleReconnect(reason: string): void {
    if (this.closed) return;
    this.opts.onDown?.(reason);
    const base = this.opts.baseDelayMs ?? 1000;
    const max = this.opts.maxDelayMs ?? 60_000;
    const delay = Math.min(max, base * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
