import type {
  PaperAccount,
  PaperAccountUpdate,
  PaperEvent,
  PaperOrder,
  PaperOrderDraft,
  PaperPosition,
  PaperPositionUpdate,
  PaperStats,
} from '@radar/shared';
import type { TaxMonth } from '@radar/core';
import { create } from 'zustand';
import { api } from './api';
import { usePrefs } from './prefs';
import { marketSocket } from './ws';

export interface PaperState {
  account: PaperAccount;
  equity: number;
  positions: PaperPosition[];
  orders: PaperOrder[];
  events: PaperEvent[];
  fx: number | null;
  /** Stops executados hoje e nos últimos 7 dias (anti-revanche). */
  stops: { today: number; week: number };
}

export interface PaperJournal {
  account: PaperAccount;
  trades: PaperPosition[];
  stats: PaperStats;
  tax: TaxMonth[];
}

interface Store {
  accounts: PaperAccount[];
  loaded: boolean;
  state: PaperState | null;
  journal: PaperJournal | null;
  error: string | null;
  load(): Promise<void>;
  activeId(): string | null;
  refresh(): Promise<void>;
  loadJournal(all?: boolean): Promise<void>;
  createAccount(name: string, initialBalance: number): Promise<PaperAccount>;
  updateAccount(id: string, u: PaperAccountUpdate): Promise<void>;
  reset(id: string, initialBalance: number): Promise<void>;
  order(o: Omit<PaperOrderDraft, 'accountId'>): Promise<PaperOrder>;
  cancel(id: string): Promise<void>;
  updatePosition(id: string, u: Partial<PaperPositionUpdate>): Promise<void>;
}

export const usePaper = create<Store>()((set, get) => ({
  accounts: [],
  loaded: false,
  state: null,
  journal: null,
  error: null,
  async load() {
    const r = await api<{ accounts: PaperAccount[] }>('/api/paper/accounts');
    set({ accounts: r.accounts, loaded: true });
    await get().refresh();
  },
  activeId() {
    const { accounts } = get();
    const pref = usePrefs.getState().paperAccountId;
    return accounts.find((a) => a.id === pref)?.id ?? accounts[0]?.id ?? null;
  },
  async refresh() {
    const id = get().activeId();
    if (!id) {
      set({ state: null });
      return;
    }
    try {
      const prev = get().state;
      const next = await api<PaperState>(`/api/paper/accounts/${id}/state`);
      set({ state: next, error: null });
      // posição encerrada (pela tela ou pelo servidor: stop/alvo) → atualiza o diário
      const closed = prev?.positions.some((p) => !next.positions.find((n) => n.id === p.id));
      if (closed && get().journal) void get().loadJournal();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  async loadJournal(all = false) {
    const id = get().activeId();
    if (!id) return;
    set({
      journal: await api<PaperJournal>(`/api/paper/accounts/${id}/journal?all=${all ? 1 : 0}`),
    });
  },
  async createAccount(name, initialBalance) {
    const a = await api<PaperAccount>('/api/paper/accounts', {
      method: 'POST',
      body: JSON.stringify({ name, initialBalance }),
    });
    usePrefs.getState().setPaperAccount(a.id);
    await get().load();
    return a;
  },
  async updateAccount(id, u) {
    await api(`/api/paper/accounts/${id}`, { method: 'PUT', body: JSON.stringify(u) });
    await get().load();
  },
  async reset(id, initialBalance) {
    await api(`/api/paper/accounts/${id}/reset`, {
      method: 'POST',
      body: JSON.stringify({ initialBalance }),
    });
    await get().load();
    await get().loadJournal();
  },
  async order(o) {
    const accountId = get().activeId();
    if (!accountId) throw new Error('Crie uma conta de treino primeiro.');
    const r = await api<PaperOrder>('/api/paper/orders', {
      method: 'POST',
      body: JSON.stringify({ ...o, accountId }),
    });
    await get().refresh();
    return r;
  },
  async cancel(id) {
    await api(`/api/paper/orders/${id}`, { method: 'DELETE' });
    await get().refresh();
  },
  async updatePosition(id, u) {
    await api(`/api/paper/positions/${id}`, { method: 'PUT', body: JSON.stringify(u) });
    await get().refresh();
  },
}));

// execuções feitas pelo servidor (stop, alvo, ordem pendente) atualizam a tela na hora
marketSocket.onSync((m) => {
  if (m.topic !== 'paper') return;
  const s = usePaper.getState();
  if (!s.loaded) return;
  void s.refresh();
  if (s.journal) void s.loadJournal();
});
