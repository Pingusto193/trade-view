import type { Delay, FeedStatus, Market, Watchlist } from '@radar/shared';
import { create } from 'zustand';
import { api } from './api';
import { CLIENT_ID } from './client-id';
import { marketSocket } from './ws';

export interface Quote {
  name?: string;
  symbol?: string;
  market?: Market;
  currency?: string;
  priceDecimals?: number;
  last?: number | null;
  time?: number | null;
  changePct?: number | null;
  status?: FeedStatus;
  delay?: Delay;
  error?: string;
}

interface WatchlistsState {
  lists: Watchlist[];
  activeId: number | null;
  quotes: Record<string, Quote>;
  loaded: boolean;
  load(): Promise<void>;
  setActive(id: number): void;
  update(list: Watchlist): Promise<void>;
  create(name: string): Promise<void>;
  remove(id: number): Promise<void>;
  refreshQuotes(ids: string[]): Promise<void>;
}

export const useWatchlists = create<WatchlistsState>()((set, get) => ({
  lists: [],
  activeId: null,
  quotes: {},
  loaded: false,
  async load() {
    const r = await api<{ watchlists: Watchlist[] }>('/api/watchlists');
    const active = r.watchlists.find((l) => l.id === get().activeId) ?? r.watchlists[0];
    set({ lists: r.watchlists, activeId: active?.id ?? null, loaded: true });
  },
  setActive: (activeId) => set({ activeId }),
  async update(list) {
    set((s) => ({ lists: s.lists.map((l) => (l.id === list.id ? list : l)) }));
    await api(`/api/watchlists/${list.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: list.name, items: list.items }),
    });
  },
  async create(name) {
    const l = await api<Watchlist>('/api/watchlists', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    set((s) => ({ lists: [...s.lists, l], activeId: l.id }));
  },
  async remove(id) {
    await api(`/api/watchlists/${id}`, { method: 'DELETE' });
    set((s) => {
      const lists = s.lists.filter((l) => l.id !== id);
      return { lists, activeId: lists[0]?.id ?? null };
    });
  },
  async refreshQuotes(ids) {
    if (!ids.length) return;
    const r = await api<{ quotes: Record<string, Quote> }>(
      `/api/quotes?ids=${encodeURIComponent(ids.join(','))}`,
    );
    set((s) => ({ quotes: { ...s.quotes, ...r.quotes } }));
  },
}));

marketSocket.onSync((m) => {
  if (m.topic === 'watchlists' && m.origin !== CLIENT_ID && useWatchlists.getState().loaded) {
    void useWatchlists.getState().load();
  }
});
