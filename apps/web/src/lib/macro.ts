import { create } from 'zustand';
import { api } from './api';

export interface BrasilPanel {
  selic: { value: number; date: number } | null;
  cdi: {
    dailyPct: number;
    annualPct: number;
    date: number;
    acc12m: number | null;
    accYtd: number | null;
  } | null;
  status: { state: 'ok' | 'error'; message?: string; lastValidAt?: number };
  source: string;
}

export const useBrasil = create<{
  data: BrasilPanel | null;
  error: string | null;
  load(): Promise<void>;
}>()((set) => ({
  data: null,
  error: null,
  async load() {
    try {
      set({ data: await api<BrasilPanel>('/api/macro/brasil'), error: null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
}));

/** CDI acumulado num período (fração), ou null se o servidor não tiver dados que cubram. */
export async function cdiBetween(from: number, to: number) {
  const r = await api<{ cdi: { acc: number; days: number; until: number } | null }>(
    `/api/macro/cdi?from=${Math.floor(from)}&to=${Math.floor(to)}`,
  );
  return r.cdi;
}
