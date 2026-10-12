import type { Drawing, DrawingKind } from '@radar/shared';
import { create } from 'zustand';
import { api } from './api';
import { CLIENT_ID } from './client-id';
import { marketSocket } from './ws';

/**
 * Desenhos por ativo, guardados no servidor e sincronizados entre aparelhos (SPEC §7).
 * Mudanças são otimistas: aparecem na hora e são enviadas ao servidor em seguida.
 */
interface DrawingsState {
  bySymbol: Record<string, Drawing[]>;
  error: string | null;
  load(symbolId: string): Promise<void>;
  save(d: Drawing): void;
  remove(d: Drawing): void;
}

export const useDrawings = create<DrawingsState>()((set, get) => ({
  bySymbol: {},
  error: null,
  async load(symbolId) {
    try {
      const r = await api<{ drawings: Drawing[] }>(
        `/api/drawings?symbolId=${encodeURIComponent(symbolId)}`,
      );
      set((s) => ({ bySymbol: { ...s.bySymbol, [symbolId]: r.drawings }, error: null }));
    } catch (e) {
      set({ error: `Não foi possível carregar os desenhos: ${(e as Error).message}` });
    }
  },
  save(d) {
    const list = get().bySymbol[d.symbolId] ?? [];
    const next = list.some((x) => x.id === d.id)
      ? list.map((x) => (x.id === d.id ? d : x))
      : [...list, d];
    set((s) => ({ bySymbol: { ...s.bySymbol, [d.symbolId]: next } }));
    api(`/api/drawings/${d.id}`, { method: 'PUT', body: JSON.stringify(d) }).catch((e: Error) => {
      set({ error: `Desenho não foi salvo no servidor: ${e.message}` });
    });
  },
  remove(d) {
    const list = get().bySymbol[d.symbolId] ?? [];
    set((s) => ({ bySymbol: { ...s.bySymbol, [d.symbolId]: list.filter((x) => x.id !== d.id) } }));
    api(`/api/drawings/${d.id}`, { method: 'DELETE' }).catch((e: Error) => {
      set({ error: `Desenho não foi apagado no servidor: ${e.message}` });
    });
  },
}));

// Outro aparelho mudou desenhos → recarrega aquele ativo (se estiver carregado aqui).
marketSocket.onSync((m) => {
  if (m.topic !== 'drawings' || !m.symbolId || m.origin === CLIENT_ID) return;
  if (useDrawings.getState().bySymbol[m.symbolId]) void useDrawings.getState().load(m.symbolId);
});
// Ao voltar para o app (celular), confere se há novidades.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    for (const id of Object.keys(useDrawings.getState().bySymbol))
      void useDrawings.getState().load(id);
  });
}

/** Estado da barra de ferramentas (global: vale para o gráfico que receber o toque). */
interface ToolState {
  tool: DrawingKind | null;
  side: 'long' | 'short';
  selectedId: string | null;
  setTool(tool: DrawingKind | null, side?: 'long' | 'short'): void;
  select(id: string | null): void;
}

export const useDrawingTool = create<ToolState>()((set) => ({
  tool: null,
  side: 'long',
  selectedId: null,
  setTool: (tool, side) => set((s) => ({ tool, side: side ?? s.side, selectedId: null })),
  select: (selectedId) => set({ selectedId }),
}));

export function newDrawingId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return `d${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}
