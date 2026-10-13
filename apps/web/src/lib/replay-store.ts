import type { ReplayBook } from '@radar/core';
import type {
  Candle,
  PaperStats,
  ReplayCreate,
  ReplayMoveInput,
  ReplayOrderInput,
  SymbolMeta,
  Timeframe,
} from '@radar/shared';
import { create } from 'zustand';
import type { LiveSeriesEvents } from '../chart/live-series';
import type { SeriesSource } from '../chart/ChartView';
import { api } from './api';

export interface ReplayView {
  id: string;
  hidden: boolean;
  status: 'ativa' | 'encerrada';
  tf: Timeframe;
  symbol: string;
  symbolId: string | null;
  meta: SymbolMeta;
  candles: Candle[];
  cursor: number;
  total: number;
  startIndex: number;
  book: ReplayBook;
  equity: number;
  createdAt: number;
}

export interface ReplaySummary {
  id: string;
  label: string;
  tf: Timeframe;
  status: 'ativa' | 'encerrada';
  trades: number;
  resultBrl: number;
  avgR: number | null;
  createdAt: number;
}

type Reveal = (candles: Candle[]) => void;
const revealListeners = new Set<Reveal>();

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

/** Replay (SPEC §13). O servidor guarda o futuro; aqui só chegam os candles já revelados. */
export const useReplay = create<{
  sessions: ReplaySummary[];
  view: ReplayView | null;
  busy: boolean;
  error: string | null;
  list(): Promise<void>;
  open(id: string): Promise<void>;
  close(): void;
  start(input: ReplayCreate): Promise<void>;
  advance(n: number): Promise<void>;
  order(o: ReplayOrderInput): Promise<void>;
  cancel(orderId: string): Promise<void>;
  move(u: ReplayMoveInput): Promise<void>;
  end(): Promise<void>;
  remove(id: string): Promise<void>;
}>()((set, get) => {
  const run = async (fn: () => Promise<void>) => {
    set({ busy: true, error: null });
    try {
      await fn();
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    } finally {
      set({ busy: false });
    }
  };
  const id = () => {
    const v = get().view;
    if (!v) throw new Error('Nenhuma sessão de replay aberta.');
    return v.id;
  };
  return {
    sessions: [],
    view: null,
    busy: false,
    error: null,
    async list() {
      try {
        const r = await api<{ sessions: ReplaySummary[] }>('/api/replay/sessions');
        set({ sessions: r.sessions });
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },
    open: (sid) =>
      run(async () => {
        set({ view: await api<ReplayView>(`/api/replay/sessions/${sid}`) });
      }),
    close: () => set({ view: null, error: null }),
    start: (input) =>
      run(async () => {
        set({ view: await api<ReplayView>('/api/replay/sessions', json('POST', input)) });
      }),
    advance: (n) =>
      run(async () => {
        const v = get().view;
        if (!v || v.status !== 'ativa') return;
        const r = await api<ReplayView & { revealed: Candle[] }>(
          `/api/replay/sessions/${v.id}/advance`,
          json('POST', { n }),
        );
        const { revealed, ...rest } = r;
        // o gráfico recebe só o que é novo (sem recarregar tudo a cada clique)
        set({ view: { ...rest, candles: [...v.candles, ...revealed] } });
        for (const fn of revealListeners) fn(revealed);
      }),
    order: (o) =>
      run(async () => {
        set({
          view: await api<ReplayView>(`/api/replay/sessions/${id()}/orders`, json('POST', o)),
        });
      }),
    cancel: (orderId) =>
      run(async () => {
        set({
          view: await api<ReplayView>(
            `/api/replay/sessions/${id()}/orders/${orderId}`,
            json('DELETE'),
          ),
        });
      }),
    move: (u) =>
      run(async () => {
        set({
          view: await api<ReplayView>(`/api/replay/sessions/${id()}/position`, json('PATCH', u)),
        });
      }),
    end: () =>
      run(async () => {
        set({ view: await api<ReplayView>(`/api/replay/sessions/${id()}/end`, json('POST')) });
        void get().list();
      }),
    remove: (sid) =>
      run(async () => {
        await api(`/api/replay/sessions/${sid}`, json('DELETE'));
        if (get().view?.id === sid) set({ view: null });
        await get().list();
      }),
  };
});

export const replayJournal = () =>
  api<{ stats: PaperStats; trades: number }>('/api/replay/journal');

/**
 * Fonte de candles do gráfico no replay: começa com os candles revelados e recebe cada candle novo
 * como um candle FECHADO (os indicadores e os detectores rodam igual ao ao vivo).
 */
export class ReplaySource implements SeriesSource {
  candles: Candle[] = [];
  private off: (() => void) | null = null;

  constructor(
    private readonly view: () => ReplayView | null,
    private readonly ev: LiveSeriesEvents,
  ) {}

  async start(): Promise<void> {
    const v = this.view();
    if (!v) return;
    this.candles = [...v.candles];
    this.ev.onStatus({ state: 'ok' });
    this.ev.onReset(this.candles, v.meta, false);
    const fn: Reveal = (cs) => {
      for (const c of cs) {
        this.candles.push(c);
        this.ev.onUpdate(c, true);
      }
    };
    revealListeners.add(fn);
    this.off = () => revealListeners.delete(fn);
  }

  dispose(): void {
    this.off?.();
  }
}
