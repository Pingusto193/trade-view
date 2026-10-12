import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FetchFn } from '../src/http';
import type { WsLike } from '../src/ws';

const FIX = fileURLToPath(new URL('../fixtures/', import.meta.url));

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(`${FIX}${name}`, 'utf8')) as T;
}

export interface Route {
  match: (url: string) => boolean;
  body?: unknown;
  status?: number;
  headers?: Record<string, string>;
}

/** fetch falso: responde conforme rotas e registra as URLs chamadas. */
export function fakeFetch(routes: Route[]): FetchFn & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const r = routes.find((x) => x.match(url));
    if (!r) return new Response('não encontrado', { status: 404 });
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  }) as FetchFn & { calls: string[] };
  fn.calls = calls;
  return fn;
}

/** WebSocket falso controlado pelo teste. */
export class FakeWs implements WsLike {
  static instances: FakeWs[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeWs.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  emit(obj: unknown): void {
    this.onmessage?.({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  /** Simula queda da conexão vinda do servidor. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}
