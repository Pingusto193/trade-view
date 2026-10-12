import type { ExperimentId, ExperimentRun } from '@radar/shared';
import { create } from 'zustand';
import { api } from './api';

interface ExperimentsState {
  latest: Partial<Record<ExperimentId, ExperimentRun>>;
  loaded: boolean;
  error: string | null;
  load(): Promise<void>;
  run(id: ExperimentId, symbols: string[]): Promise<void>;
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Experimentos prontos: começa no servidor e acompanha o progresso até terminar. */
export const useExperiments = create<ExperimentsState>()((set, get) => ({
  latest: {},
  loaded: false,
  error: null,
  async load() {
    try {
      const r = await api<{ latest: ExperimentsState['latest'] }>('/api/experiments');
      set({ latest: r.latest, loaded: true, error: null });
      // alguma ainda rodando (ex.: a tela foi recarregada no meio): continua acompanhando
      for (const run of Object.values(r.latest))
        if (run?.status === 'running') void follow(run.id, set, get);
    } catch (e) {
      set({ error: (e as Error).message, loaded: true });
    }
  },
  async run(id, symbols) {
    set({ error: null });
    try {
      const run = await api<ExperimentRun>(`/api/experiments/${id}/run`, {
        method: 'POST',
        body: JSON.stringify({ symbols }),
      });
      set({ latest: { ...get().latest, [id]: run } });
      await follow(run.id, set, get);
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
}));

async function follow(
  runId: string,
  set: (p: Partial<ExperimentsState>) => void,
  get: () => ExperimentsState,
) {
  let failures = 0;
  for (;;) {
    await sleep(1500);
    let run: ExperimentRun;
    try {
      run = await api<ExperimentRun>(`/api/experiments/runs/${runId}`);
      failures = 0;
    } catch (e) {
      // rede oscilou: tenta de novo, mas não para sempre
      if (++failures >= 20) {
        set({ error: `Perdi o contato com o servidor: ${(e as Error).message}` });
        return;
      }
      continue;
    }
    set({ latest: { ...get().latest, [run.experimentId]: run } });
    if (run.status !== 'running') return;
  }
}
