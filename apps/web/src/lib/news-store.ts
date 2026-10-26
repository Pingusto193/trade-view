import type { AssetTag, NewsItem, NewsSourceStatus } from '@radar/shared';
import { create } from 'zustand';
import { api } from './api';
import { marketSocket } from './ws';

export interface AgendaEvent {
  id: string;
  kind: string;
  title: string;
  country: 'BR' | 'US';
  at: number;
  approximate: boolean;
  source: string;
  tags: AssetTag[];
}

interface Feed {
  items: NewsItem[];
  loading: boolean;
  error: string | null;
}

/** Chave do feed: os ativos (ordenados) ou "*" para tudo. */
export const feedKey = (symbols?: readonly string[]) =>
  symbols?.length ? [...symbols].sort().join(',') : '*';

/** Notícias (SPEC §23.1): feeds por conjunto de ativos, recarregados quando chega notícia nova. */
export const useNews = create<{
  feeds: Record<string, Feed>;
  sources: NewsSourceStatus[] | null;
  agenda: AgendaEvent[] | null;
  load(symbols?: readonly string[], since?: number): Promise<void>;
  loadSources(): Promise<void>;
  loadAgenda(): Promise<void>;
}>()((set) => ({
  feeds: {},
  sources: null,
  agenda: null,
  async loadAgenda() {
    const r = await api<{ events: AgendaEvent[] }>('/api/news/agenda');
    set({ agenda: r.events });
  },
  async load(symbols, since) {
    const key = feedKey(symbols);
    set((s) => ({
      feeds: {
        ...s.feeds,
        [key]: { items: s.feeds[key]?.items ?? [], loading: true, error: null },
      },
    }));
    const p = new URLSearchParams({ limit: '200' });
    if (symbols?.length) p.set('symbols', symbols.join(','));
    if (since !== undefined) p.set('since', String(Math.floor(since)));
    try {
      const r = await api<{ items: NewsItem[] }>(`/api/news?${p.toString()}`);
      set((s) => ({
        feeds: { ...s.feeds, [key]: { items: r.items, loading: false, error: null } },
      }));
    } catch (e) {
      set((s) => ({
        feeds: {
          ...s.feeds,
          [key]: { items: s.feeds[key]?.items ?? [], loading: false, error: (e as Error).message },
        },
      }));
    }
  },
  async loadSources() {
    const r = await api<{ sources: NewsSourceStatus[] }>('/api/news/sources');
    set({ sources: r.sources });
  },
}));

// notícia nova no servidor: recarrega os feeds abertos
marketSocket.onSync((m) => {
  if (m.topic !== 'news') return;
  const st = useNews.getState();
  for (const key of Object.keys(st.feeds)) void st.load(key === '*' ? undefined : key.split(','));
});
