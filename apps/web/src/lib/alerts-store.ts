import type {
  Alert,
  AlertFire,
  AlertInput,
  Channel,
  NotifySettings,
  NotifySettingsInput,
} from '@radar/shared';
import { create } from 'zustand';
import { api } from './api';
import { CLIENT_ID } from './client-id';
import { marketSocket } from './ws';

interface AlertsState {
  alerts: Alert[];
  fires: AlertFire[];
  settings: NotifySettings | null;
  loaded: boolean;
  load(): Promise<void>;
  loadHistory(): Promise<void>;
  loadSettings(): Promise<void>;
  create(a: AlertInput): Promise<Alert>;
  update(id: string, a: AlertInput): Promise<Alert>;
  remove(id: string): Promise<void>;
  saveSettings(s: NotifySettingsInput): Promise<void>;
  test(ch: Channel): Promise<string>;
}

export const useAlerts = create<AlertsState>()((set, get) => ({
  alerts: [],
  fires: [],
  settings: null,
  loaded: false,
  async load() {
    const r = await api<{ alerts: Alert[] }>('/api/alerts');
    set({ alerts: r.alerts, loaded: true });
  },
  async loadHistory() {
    const r = await api<{ fires: AlertFire[] }>('/api/alerts/history?limit=200');
    set({ fires: r.fires });
  },
  async loadSettings() {
    set({ settings: await api<NotifySettings>('/api/notify/settings') });
  },
  async create(a) {
    const r = await api<Alert>('/api/alerts', { method: 'POST', body: JSON.stringify(a) });
    await get().load();
    return r;
  },
  async update(id, a) {
    const r = await api<Alert>(`/api/alerts/${id}`, { method: 'PUT', body: JSON.stringify(a) });
    await get().load();
    return r;
  },
  async remove(id) {
    await api(`/api/alerts/${id}`, { method: 'DELETE' });
    set({ alerts: get().alerts.filter((x) => x.id !== id) });
  },
  async saveSettings(s) {
    set({
      settings: await api<NotifySettings>('/api/notify/settings', {
        method: 'PUT',
        body: JSON.stringify(s),
      }),
    });
  },
  async test(channel) {
    const r = await api<{ result: string }>('/api/notify/test', {
      method: 'POST',
      body: JSON.stringify({ channel }),
    });
    return r.result;
  },
}));

/** Campos editáveis de um alerta já salvo (para reenviar no PUT). */
export function toInput(a: Alert): AlertInput {
  return {
    symbolId: a.symbolId,
    tf: a.tf,
    condition: a.condition,
    trigger: a.trigger,
    channels: a.channels,
    repeat: a.repeat,
    cooldownMin: a.cooldownMin,
    enabled: a.enabled,
    note: a.note,
  };
}

// disparos e mudanças vindos do servidor (ou de outro aparelho) atualizam a tela
marketSocket.onSync((m) => {
  if (m.topic !== 'alerts' || m.origin === CLIENT_ID) return;
  const s = useAlerts.getState();
  if (s.loaded) void s.load();
  void s.loadHistory();
});

/** Formulário de alerta aberto de qualquer tela (gráfico, desenho, painel de setups). */
interface AlertFormState {
  draft: (Partial<AlertInput> & { id?: string }) | null;
  open(draft: Partial<AlertInput> & { id?: string }): void;
  close(): void;
}

export const useAlertForm = create<AlertFormState>()((set) => ({
  draft: null,
  open: (draft) => set({ draft }),
  close: () => set({ draft: null }),
}));
