import type { SetupId } from '@radar/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AnalysisPayload } from '../chart/indicator-worker';

/** Resultado da análise (setups + contexto) por ativo e escala, vindo do worker. */
interface AnalysisState {
  byKey: Record<string, AnalysisPayload>;
  /** Pedido para o gráfico focar num candle (índice). */
  focus: { key: string; index: number; nonce: number } | null;
  apply(key: string, payload: AnalysisPayload, reset: boolean): void;
  clear(key: string): void;
  focusOn(key: string, index: number): void;
}

const MAX_EVENTS = 3000;

export const useAnalysis = create<AnalysisState>()((set) => ({
  byKey: {},
  focus: null,
  apply: (key, p, reset) =>
    set((s) => {
      const prev = s.byKey[key];
      const events = reset || !prev ? p.events : [...prev.events, ...p.events].slice(-MAX_EVENTS);
      return { byKey: { ...s.byKey, [key]: { ...p, events } } };
    }),
  clear: (key) =>
    set((s) => {
      const next = { ...s.byKey };
      delete next[key];
      return { byKey: next };
    }),
  focusOn: (key, index) => set({ focus: { key, index, nonce: Date.now() } }),
}));

export const analysisKey = (id: string, tf: string) => `${id}|${tf}`;

/** Quais setups aparecem no gráfico (preferência local de visualização). */
interface SetupViewState {
  hidden: SetupId[];
  showRadar: boolean;
  toggle(id: SetupId): void;
  setShowRadar(v: boolean): void;
}

export const useSetupView = create<SetupViewState>()(
  persist(
    (set) => ({
      hidden: [],
      showRadar: false,
      toggle: (id) =>
        set((s) => ({
          hidden: s.hidden.includes(id) ? s.hidden.filter((x) => x !== id) : [...s.hidden, id],
        })),
      setShowRadar: (showRadar) => set({ showRadar }),
    }),
    { name: 'radar-setup-view' },
  ),
);
