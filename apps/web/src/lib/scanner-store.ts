import type {
  SavedScan,
  SavedScanInput,
  ScanRunInput,
  ScanSnapshot,
  ScanUniverses,
} from '@radar/shared';
import { create } from 'zustand';
import { api } from './api';
import { CLIENT_ID } from './client-id';
import { marketSocket } from './ws';

/** Qual resultado está na tela: a varredura avulsa ou uma salva. */
export type ScanView = { kind: 'adhoc' } | { kind: 'saved'; id: string };

interface ScannerState {
  universes: ScanUniverses | null;
  saved: SavedScan[];
  view: ScanView;
  snapshot: ScanSnapshot | null;
  loaded: boolean;
  error: string | null;
  init(): Promise<void>;
  /** Mostra o resultado avulso ou o de uma varredura salva (e acompanha se estiver rodando). */
  show(view: ScanView): Promise<void>;
  run(input: ScanRunInput): Promise<void>;
  runSaved(id: string): Promise<void>;
  save(input: SavedScanInput, id?: string): Promise<SavedScan | null>;
  remove(id: string): Promise<void>;
  refreshSaved(): Promise<void>;
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sameView = (a: ScanView, b: ScanView) =>
  a.kind === b.kind && (a.kind === 'adhoc' || a.id === (b as { id: string }).id);

const resultUrl = (v: ScanView) =>
  v.kind === 'adhoc' ? '/api/scanner/adhoc' : `/api/scanner/saved/${v.id}/result`;

/** Scanner: começa no servidor e acompanha o progresso até terminar (como os experimentos). */
export const useScanner = create<ScannerState>()((set, get) => {
  let following = 0;

  /** Consulta o resultado até ele parar de rodar (ou a tela trocar de varredura). */
  async function follow(view: ScanView) {
    const ticket = ++following;
    let failures = 0;
    for (;;) {
      await sleep(1200);
      if (ticket !== following || !sameView(get().view, view)) return;
      try {
        const r = await api<{ snapshot: ScanSnapshot | null }>(resultUrl(view));
        failures = 0;
        if (ticket !== following) return;
        set({ snapshot: r.snapshot });
        if (!r.snapshot?.running) {
          void get().refreshSaved();
          return;
        }
      } catch (e) {
        // rede oscilou: tenta de novo, mas não para sempre
        if (++failures >= 20) {
          set({ error: `Perdi o contato com o servidor: ${(e as Error).message}` });
          return;
        }
      }
    }
  }

  return {
    universes: null,
    saved: [],
    view: { kind: 'adhoc' },
    snapshot: null,
    loaded: false,
    error: null,
    async init() {
      try {
        const [universes, saved] = await Promise.all([
          api<ScanUniverses>('/api/scanner/universes'),
          api<{ scans: SavedScan[] }>('/api/scanner/saved'),
        ]);
        set({ universes, saved: saved.scans, loaded: true, error: null });
        await get().show(get().view);
      } catch (e) {
        set({ error: (e as Error).message, loaded: true });
      }
    },
    async show(view) {
      set({ view, error: null });
      try {
        const r = await api<{ snapshot: ScanSnapshot | null }>(resultUrl(view));
        if (!sameView(get().view, view)) return;
        set({ snapshot: r.snapshot });
        if (r.snapshot?.running) void follow(view);
      } catch (e) {
        set({ error: (e as Error).message, snapshot: null });
      }
    },
    async run(input) {
      set({ error: null, view: { kind: 'adhoc' } });
      try {
        const snapshot = await api<ScanSnapshot>('/api/scanner/run', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        set({ snapshot });
        await follow({ kind: 'adhoc' });
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },
    async runSaved(id) {
      const view: ScanView = { kind: 'saved', id };
      set({ error: null, view });
      try {
        const snapshot = await api<ScanSnapshot>(`/api/scanner/saved/${id}/run`, {
          method: 'POST',
        });
        set({ snapshot });
        void get().refreshSaved();
        await follow(view);
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },
    async save(input, id) {
      set({ error: null });
      try {
        const s = await api<SavedScan>(id ? `/api/scanner/saved/${id}` : '/api/scanner/saved', {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify(input),
        });
        await get().refreshSaved();
        return s;
      } catch (e) {
        set({ error: (e as Error).message });
        return null;
      }
    },
    async remove(id) {
      try {
        await api(`/api/scanner/saved/${id}`, { method: 'DELETE' });
        const v = get().view;
        if (v.kind === 'saved' && v.id === id) set({ view: { kind: 'adhoc' }, snapshot: null });
        await get().refreshSaved();
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },
    async refreshSaved() {
      try {
        const r = await api<{ scans: SavedScan[] }>('/api/scanner/saved');
        set({ saved: r.scans });
      } catch {
        // a lista atual continua na tela; o erro aparece na próxima ação
      }
    },
  };
});

// Agenda terminou noutro lugar (ou noutro aparelho): atualiza a lista e o resultado na tela.
marketSocket.onSync((m) => {
  if (m.topic !== 'scanner' || m.origin === CLIENT_ID) return;
  const s = useScanner.getState();
  if (!s.loaded) return;
  void s.refreshSaved();
  if (!s.snapshot?.running) void s.show(s.view);
});
