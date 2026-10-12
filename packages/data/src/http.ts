import { DataSourceError, RateLimitError } from './types';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  source: string;
  fetch?: FetchFn;
  /** Máximo de requisições por janela. */
  maxRequests: number;
  /** Janela em ms. */
  perMs: number;
  /** Tentativas extras em erros transitórios (429, 5xx, rede). */
  retries?: number;
  /** Atraso base do backoff exponencial em ms. */
  backoffMs?: number;
  headers?: Record<string, string>;
  /** Para testes: substitui o relógio/espera. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Cliente HTTP com **fila**, **limite de requisições** e **backoff** (SPEC §6).
 * Garante que nunca passamos do limite da fonte e reporta quando o limite foi atingido.
 */
export class HttpClient {
  private readonly stamps: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly fetchFn: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Momento até o qual a fonte pediu para esperar (Retry-After). */
  private blockedUntil = 0;
  onRateLimited?: (retryAfterMs: number) => void;

  constructor(private readonly opts: HttpClientOptions) {
    this.fetchFn = opts.fetch ?? ((i, init) => fetch(i, init));
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
  }

  get rateLimited(): boolean {
    return this.now() < this.blockedUntil;
  }

  /** GET que devolve JSON, passando pela fila. */
  getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const run = this.queue.then(() => this.execute<T>(url, headers));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async waitSlot(): Promise<void> {
    for (;;) {
      const now = this.now();
      if (now < this.blockedUntil) {
        await this.sleep(this.blockedUntil - now);
        continue;
      }
      while (this.stamps.length && (this.stamps[0] as number) <= now - this.opts.perMs) {
        this.stamps.shift();
      }
      if (this.stamps.length < this.opts.maxRequests) {
        this.stamps.push(now);
        return;
      }
      await this.sleep((this.stamps[0] as number) + this.opts.perMs - now + 1);
    }
  }

  private async execute<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const retries = this.opts.retries ?? 3;
    const base = this.opts.backoffMs ?? 1000;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.waitSlot();
      let res: Response;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 20_000);
        try {
          res = await this.fetchFn(url, {
            headers: { ...this.opts.headers, ...headers },
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        lastErr = new DataSourceError(
          `Falha de rede ao acessar ${this.opts.source}: ${(err as Error).message}`,
          this.opts.source,
        );
        await this.sleep(base * 2 ** attempt);
        continue;
      }
      if (res.ok) return (await res.json()) as T;

      if (res.status === 429 || res.status === 418) {
        const ra = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : base * 2 ** (attempt + 2);
        this.blockedUntil = this.now() + wait;
        this.onRateLimited?.(wait);
        lastErr = new RateLimitError(this.opts.source, wait);
        if (attempt < retries) continue;
        throw lastErr;
      }
      const body = await res.text().catch(() => '');
      const err = new DataSourceError(
        `${this.opts.source} respondeu HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
        this.opts.source,
        res.status,
      );
      if (res.status >= 500) {
        lastErr = err;
        await this.sleep(base * 2 ** attempt);
        continue;
      }
      throw err; // 4xx não se resolve com nova tentativa
    }
    throw lastErr;
  }
}
