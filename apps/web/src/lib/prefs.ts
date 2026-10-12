import { BUILT_IN_PRESETS, CHANNEL_PRESET, type IndicatorPreset } from '@radar/core';
import { DEFAULT_PREFS, type Prefs, type Timeframe } from '@radar/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from './api';
import { CLIENT_ID } from './client-id';
import { marketSocket } from './ws';

export type ChartType = Prefs['chartType'];

/**
 * Preferências: a fonte da verdade é o servidor (SPEC §17). O navegador guarda uma cópia só para
 * abrir rápido; ao entrar, carrega do servidor; cada mudança é enviada ao servidor.
 */
interface PrefsState extends Prefs {
  customPresets: IndicatorPreset[];
  recent: { id: string; tf: Timeframe }[];
  serverLoaded: boolean;
  setChartType(t: ChartType): void;
  setPresetId(id: string): void;
  setFractalId(id: string): void;
  setRisk(p: Partial<Pick<Prefs, 'capital' | 'riskPct' | 'maxRiskPct'>>): void;
  setSetupParams(p: Record<string, unknown>): void;
  setMode(mode: Prefs['mode']): void;
  setPaperAccount(id: string): void;
  pushRecent(id: string, tf: Timeframe): void;
  loadFromServer(): Promise<void>;
  savePreset(p: IndicatorPreset): Promise<void>;
  deletePreset(id: string): Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function pushToServer(patch: Partial<Prefs>) {
  pending = { ...pending, ...patch };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const body = pending;
    pending = {};
    api('/api/prefs', { method: 'PUT', body: JSON.stringify(body) }).catch(() => undefined);
  }, 400);
}
let pending: Partial<Prefs> = {};

export const usePrefs = create<PrefsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_PREFS,
      customPresets: [],
      recent: [],
      serverLoaded: false,
      setChartType: (chartType) => {
        set({ chartType });
        pushToServer({ chartType });
      },
      setPresetId: (presetId) => {
        set({ presetId });
        pushToServer({ presetId });
      },
      setFractalId: (fractalId) => {
        set({ fractalId });
        pushToServer({ fractalId });
      },
      setRisk: (p) => {
        set(p);
        pushToServer(p);
      },
      setMode: (mode) => {
        set({ mode });
        pushToServer({ mode });
      },
      setPaperAccount: (paperAccountId) => {
        set({ paperAccountId });
        pushToServer({ paperAccountId });
      },
      setSetupParams: (setupParams) => {
        set({ setupParams });
        pushToServer({ setupParams });
      },
      pushRecent: (id, tf) => {
        set((s) => ({ recent: [{ id, tf }, ...s.recent.filter((r) => r.id !== id)].slice(0, 12) }));
        pushToServer({ lastSymbol: id, lastTf: tf });
      },
      async loadFromServer() {
        try {
          const [prefs, presets] = await Promise.all([
            api<Prefs>('/api/prefs'),
            api<{ presets: IndicatorPreset[] }>('/api/presets'),
          ]);
          set({ ...prefs, customPresets: presets.presets, serverLoaded: true });
          const recent = get().recent;
          if (prefs.lastSymbol && prefs.lastTf && recent[0]?.id !== prefs.lastSymbol) {
            set({ recent: [{ id: prefs.lastSymbol, tf: prefs.lastTf }, ...recent].slice(0, 12) });
          }
        } catch {
          // offline: segue com a cópia local
        }
      },
      async savePreset(p) {
        const saved = await api<IndicatorPreset>(`/api/presets/${encodeURIComponent(p.id)}`, {
          method: 'PUT',
          body: JSON.stringify(p),
        });
        set((s) => ({
          customPresets: [...s.customPresets.filter((x) => x.id !== saved.id), saved],
        }));
      },
      async deletePreset(id) {
        await api(`/api/presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
        set((s) => ({
          customPresets: s.customPresets.filter((x) => x.id !== id),
          presetId: s.presetId === id ? CHANNEL_PRESET.id : s.presetId,
        }));
      },
    }),
    {
      name: 'radar-prefs',
      version: 2,
      partialize: (s) => {
        const { serverLoaded: _s, ...rest } = s;
        void _s;
        return rest;
      },
    },
  ),
);

marketSocket.onSync((m) => {
  if ((m.topic === 'prefs' || m.topic === 'presets') && m.origin !== CLIENT_ID) {
    void usePrefs.getState().loadFromServer();
  }
});

export function usePreset(): IndicatorPreset {
  const { presetId, customPresets } = usePrefs();
  return [...BUILT_IN_PRESETS, ...customPresets].find((p) => p.id === presetId) ?? CHANNEL_PRESET;
}
