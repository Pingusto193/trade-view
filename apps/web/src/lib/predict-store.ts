import type { PredictParams, Scoreboard, Situation } from '@radar/core';
import type { Timeframe } from '@radar/shared';
import { create } from 'zustand';
import { api } from './api';
import { marketSocket } from './ws';

export interface PredictTarget {
  symbolId: string;
  tf: Timeframe;
  createdAt: number;
}

export interface TargetStatus {
  symbolId: string;
  tf: Timeframe;
  label: string;
  problem: string | null;
  candles: number;
  lastCandleAt: number | null;
}

export interface ScoreboardEntry {
  symbolId: string;
  tf: Timeframe;
  horizon: number;
  method: string;
  open: number;
  cancelled: number;
  board: Scoreboard;
}

export interface PredictionRow {
  id: string;
  symbolId: string;
  tf: Timeframe;
  horizon: number;
  method: string;
  candleTime: number;
  createdAt: number;
  close: number;
  p: number;
  alwaysUpP: number;
  persistUp: boolean | null;
  detail: { situation: Situation | null; levels: { id: string; n: number; rate: number | null }[] };
  status: 'aberta' | 'conferida' | 'cancelada';
  resolvedAt: number | null;
  targetTime: number | null;
  targetClose: number | null;
  up: boolean | null;
  note: string | null;
}

/** Placar ao vivo (SPEC §23.2): alvos acompanhados, previsões gravadas e o placar. */
export const usePredict = create<{
  targets: PredictTarget[] | null;
  status: TargetStatus[];
  params: PredictParams | null;
  entries: ScoreboardEntry[] | null;
  minCases: number;
  recent: PredictionRow[];
  error: string | null;
  loadTargets(): Promise<void>;
  loadScoreboard(): Promise<void>;
  loadRecent(): Promise<void>;
  addTarget(symbolId: string, tf: Timeframe): Promise<void>;
  removeTarget(symbolId: string, tf: Timeframe): Promise<void>;
}>()((set, get) => ({
  targets: null,
  status: [],
  params: null,
  entries: null,
  minCases: 30,
  recent: [],
  error: null,
  async loadTargets() {
    const r = await api<{
      targets: PredictTarget[];
      status: TargetStatus[];
      params: PredictParams;
    }>('/api/predict/targets');
    set({ targets: r.targets, status: r.status, params: r.params });
  },
  async loadScoreboard() {
    const r = await api<{ entries: ScoreboardEntry[]; minCases: number }>(
      '/api/predict/scoreboard',
    );
    set({ entries: r.entries, minCases: r.minCases });
  },
  async loadRecent() {
    const r = await api<{ predictions: PredictionRow[] }>('/api/predict/predictions?limit=60');
    set({ recent: r.predictions });
  },
  async addTarget(symbolId, tf) {
    set({ error: null });
    try {
      const r = await api<{ targets: PredictTarget[] }>('/api/predict/targets', {
        method: 'POST',
        body: JSON.stringify({ symbolId, tf }),
      });
      set({ targets: r.targets });
      void get().loadTargets();
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    }
  },
  async removeTarget(symbolId, tf) {
    const p = new URLSearchParams({ symbolId, tf });
    const r = await api<{ targets: PredictTarget[] }>(`/api/predict/targets?${p.toString()}`, {
      method: 'DELETE',
    });
    set({ targets: r.targets });
    void get().loadTargets();
  },
}));

// previsão gravada ou conferida no servidor: recarrega o que estiver aberto
marketSocket.onSync((m) => {
  if (m.topic !== 'predict') return;
  const st = usePredict.getState();
  if (st.entries) void st.loadScoreboard();
  if (st.recent.length) void st.loadRecent();
});
