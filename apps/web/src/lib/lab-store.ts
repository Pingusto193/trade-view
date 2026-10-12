import type { LabRun, LabRunDraft, LabRunSummary } from '@radar/shared';
import { create } from 'zustand';
import { api } from './api';

interface LabState {
  current: LabRun | null;
  running: boolean;
  error: string | null;
  history: LabRunSummary[];
  run(input: LabRunDraft): Promise<void>;
  open(id: string): Promise<void>;
  loadHistory(): Promise<void>;
}

/** Laboratório: toda execução fica salva no servidor (registro de tentativas, SPEC §12.3). */
export const useLab = create<LabState>()((set, get) => ({
  current: null,
  running: false,
  error: null,
  history: [],
  async run(input) {
    set({ running: true, error: null });
    try {
      const r = await api<LabRun>('/api/lab/run', { method: 'POST', body: JSON.stringify(input) });
      set({ current: r });
      void get().loadHistory();
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ running: false });
    }
  },
  async open(id) {
    set({ error: null });
    try {
      set({ current: await api<LabRun>(`/api/lab/runs/${encodeURIComponent(id)}`) });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  async loadHistory() {
    try {
      set({ history: (await api<{ runs: LabRunSummary[] }>('/api/lab/runs')).runs });
    } catch {
      // histórico é secundário: a tela continua funcionando sem ele
    }
  },
}));
