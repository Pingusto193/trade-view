import { BUILT_IN_PRESETS, CHANNEL_PRESET, type IndicatorPreset } from '@radar/core';
import type { Timeframe } from '@radar/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChartType = 'candles' | 'heikin' | 'line';

/**
 * Preferências de interface. Guardadas no navegador só por conveniência; na Fase 2 passam a ser
 * sincronizadas com o servidor (SPEC §17: nada importante só no localStorage).
 */
interface PrefsState {
  chartType: ChartType;
  presetId: string;
  customPresets: IndicatorPreset[];
  fractalId: string;
  upColor: string;
  downColor: string;
  recent: { id: string; tf: Timeframe }[];
  setChartType(t: ChartType): void;
  setPresetId(id: string): void;
  setFractalId(id: string): void;
  pushRecent(id: string, tf: Timeframe): void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      chartType: 'candles',
      presetId: CHANNEL_PRESET.id,
      customPresets: [],
      fractalId: 'swing-diario',
      upColor: '#22c55e',
      downColor: '#ef4444',
      recent: [],
      setChartType: (chartType) => set({ chartType }),
      setPresetId: (presetId) => set({ presetId }),
      setFractalId: (fractalId) => set({ fractalId }),
      pushRecent: (id, tf) =>
        set((s) => ({ recent: [{ id, tf }, ...s.recent.filter((r) => r.id !== id)].slice(0, 12) })),
    }),
    { name: 'radar-prefs', version: 1 },
  ),
);

export function usePreset(): IndicatorPreset {
  const { presetId, customPresets } = usePrefs();
  return [...BUILT_IN_PRESETS, ...customPresets].find((p) => p.id === presetId) ?? CHANNEL_PRESET;
}
