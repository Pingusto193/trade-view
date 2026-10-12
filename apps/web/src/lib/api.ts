import type { CandlesResponse, SymbolMeta, SymbolSearchResult, Timeframe } from '@radar/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
/** Registrado pelo AuthGate: sessão expirada → volta para a tela de login. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/** Chamada à API do próprio servidor (mesma origem; cookies de sessão incluídos). */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized?.();
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // corpo não-JSON
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export const getCandles = (id: string, tf: Timeframe, limit = 1500) =>
  api<CandlesResponse>(`/api/candles?id=${encodeURIComponent(id)}&tf=${tf}&limit=${limit}`);

export const searchSymbols = (q: string) =>
  api<{ results: SymbolSearchResult[] }>(`/api/symbols/search?q=${encodeURIComponent(q)}`);

export const getMeta = (id: string) => api<SymbolMeta>(`/api/meta?id=${encodeURIComponent(id)}`);

export interface SourceInfo {
  id: string;
  label: string;
  market: string;
  configured: boolean;
  simulated: boolean;
}

export const getSources = () => api<{ simulated: boolean; sources: SourceInfo[] }>('/api/sources');
