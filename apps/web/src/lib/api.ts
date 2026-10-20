import { CLIENT_ID } from './client-id';
import type {
  CandlesResponse,
  Mt5AgentStatus,
  SymbolMeta,
  SymbolSearchResult,
  Timeframe,
} from '@radar/shared';

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
      ...(init.method && init.method !== 'GET' ? { 'x-radar-client': CLIENT_ID } : {}),
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
  /** Fontes com cota diária (forex pela internet). */
  quota?: { used: number; limit: number; day: string };
}

export const getSources = () => api<{ simulated: boolean; sources: SourceInfo[] }>('/api/sources');

// ---------- agente MetaTrader 5 (ADR-0023)
export const getMt5Agents = () =>
  api<{ agents: Mt5AgentStatus[]; simulatedAllowed: boolean; url: string }>('/api/mt5/agents');

export const createMt5Token = (name: string) =>
  api<{ id: number; name: string; token: string; url: string }>('/api/mt5/tokens', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

export const revokeMt5Token = (id: number) =>
  api<{ ok: true }>(`/api/mt5/tokens/${id}`, { method: 'DELETE' });
