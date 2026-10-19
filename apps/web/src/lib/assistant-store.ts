import type { AssistantSettings } from '@radar/shared';
import { create } from 'zustand';
import { api } from './api';

/** Configuração do assistente (só para saber se o botão aparece e mostrar o gasto do mês). */
export const useAssistant = create<{
  settings: AssistantSettings | null;
  open: boolean;
  load(): Promise<void>;
  set(s: AssistantSettings): void;
  toggle(open?: boolean): void;
}>()((set, get) => ({
  settings: null,
  open: false,
  async load() {
    try {
      set({ settings: await api<AssistantSettings>('/api/assistant/settings') });
    } catch {
      // sem servidor: o botão simplesmente não aparece
    }
  },
  set: (settings) => set({ settings }),
  toggle: (open) => set({ open: open ?? !get().open }),
}));
