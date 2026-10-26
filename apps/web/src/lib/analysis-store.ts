import type { PredictionReport, SetupId } from '@radar/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AnalysisPayload } from '../chart/indicator-worker';

/** Resultado da análise (setups + contexto) por ativo e escala, vindo do worker. */
interface AnalysisState {
  byKey: Record<string, AnalysisPayload>;
  /** Pedido para o gráfico focar num candle (índice). */
  focus: { key: string; index: number; nonce: number } | null;
  /** Pedido para o gráfico ir até um instante (ex.: hora de uma notícia). */
  focusAt: { key: string; time: number; nonce: number } | null;
  focusTimeOn(key: string, time: number): void;
  apply(key: string, payload: AnalysisPayload, reset: boolean): void;
  clear(key: string): void;
  focusOn(key: string, index: number): void;
  /** Previsão (camada 1) por ativo e escala; undefined = ainda calculando. */
  predictions: Record<string, PredictionReport | null>;
  /** Quantos painéis querem a previsão de cada gráfico (o worker só calcula se > 0). */
  predictWanted: Record<string, number>;
  wantPrediction(key: string, on: boolean): void;
  setPrediction(key: string, r: PredictionReport | null): void;
}

const MAX_EVENTS = 3000;

export const useAnalysis = create<AnalysisState>()((set) => ({
  byKey: {},
  focus: null,
  focusAt: null,
  focusTimeOn: (key, time) => set({ focusAt: { key, time, nonce: Date.now() } }),
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
  predictions: {},
  predictWanted: {},
  wantPrediction: (key, on) =>
    set((s) => ({
      predictWanted: {
        ...s.predictWanted,
        [key]: Math.max(0, (s.predictWanted[key] ?? 0) + (on ? 1 : -1)),
      },
    })),
  setPrediction: (key, r) => set((s) => ({ predictions: { ...s.predictions, [key]: r } })),
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
