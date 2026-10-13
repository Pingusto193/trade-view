import type { TaxMonth } from '@radar/core';
import type {
  PaperStats,
  RealFillInput,
  RealTrade,
  RealTradeInput,
  RealTradeUpdate,
} from '@radar/shared';
import { create } from 'zustand';
import { api } from './api';
import { marketSocket } from './ws';

export interface RealJournal {
  trades: RealTrade[];
  stats: PaperStats;
  tax: TaxMonth[];
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

/** Diário de trades reais (SPEC §13). Cada mudança recarrega o diário inteiro: é pequeno. */
export const useReal = create<{
  journal: RealJournal | null;
  error: string | null;
  load(): Promise<void>;
  create(input: RealTradeInput): Promise<RealTrade>;
  addFill(id: string, fill: RealFillInput): Promise<void>;
  removeFill(id: string, fillId: string): Promise<void>;
  update(id: string, u: RealTradeUpdate): Promise<void>;
  remove(id: string): Promise<void>;
}>()((set, get) => ({
  journal: null,
  error: null,
  async load() {
    try {
      set({ journal: await api<RealJournal>('/api/real/journal'), error: null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  async create(input) {
    const t = await api<RealTrade>('/api/real/trades', json('POST', input));
    await get().load();
    return t;
  },
  async addFill(id, fill) {
    await api(`/api/real/trades/${id}/fills`, json('POST', fill));
    await get().load();
  },
  async removeFill(id, fillId) {
    await api(`/api/real/trades/${id}/fills/${fillId}`, { method: 'DELETE' });
    await get().load();
  },
  async update(id, u) {
    await api(`/api/real/trades/${id}`, json('PATCH', u));
    await get().load();
  },
  async remove(id) {
    await api(`/api/real/trades/${id}`, { method: 'DELETE' });
    await get().load();
  },
}));

// registrado no celular aparece no PC (e vice-versa)
marketSocket.onSync((m) => {
  if (m.topic !== 'real' || !useReal.getState().journal) return;
  void useReal.getState().load();
});
