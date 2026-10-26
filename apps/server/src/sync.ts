import type { ServerMessage } from '@radar/shared';

type Send = (msg: ServerMessage) => void;
type SyncMsg = Extract<ServerMessage, { type: 'sync' }>;

/**
 * Avisa os outros aparelhos do mesmo usuário quando algo muda (desenho feito no PC aparece no
 * celular — critério da Fase 2). Cada conexão WebSocket autenticada se registra aqui.
 */
export class SyncHub {
  private readonly byUser = new Map<number, Set<Send>>();
  /** Ouvintes internos do servidor (ex.: alertas recarregam quando um desenho muda). */
  private readonly internal = new Set<(userId: number, msg: SyncMsg) => void>();

  onChange(fn: (userId: number, msg: SyncMsg) => void): () => void {
    this.internal.add(fn);
    return () => this.internal.delete(fn);
  }

  register(userId: number, send: Send): () => void {
    let set = this.byUser.get(userId);
    if (!set) {
      set = new Set();
      this.byUser.set(userId, set);
    }
    set.add(send);
    return () => {
      set?.delete(send);
      if (set?.size === 0) this.byUser.delete(userId);
    };
  }

  /** Aviso para todos os usuários conectados (dados globais, ex.: notícias novas). */
  broadcast(msg: SyncMsg): void {
    for (const userId of [...this.byUser.keys()]) this.notify(userId, msg);
  }

  notify(userId: number, msg: SyncMsg): void {
    for (const fn of this.internal) {
      try {
        fn(userId, msg);
      } catch {
        // um ouvinte com defeito não impede os outros
      }
    }
    for (const s of this.byUser.get(userId) ?? []) {
      try {
        s(msg);
      } catch {
        // conexão fechando; ignorada
      }
    }
  }
}
