import type { ServerMessage } from '@radar/shared';

type Send = (msg: ServerMessage) => void;

/**
 * Avisa os outros aparelhos do mesmo usuário quando algo muda (desenho feito no PC aparece no
 * celular — critério da Fase 2). Cada conexão WebSocket autenticada se registra aqui.
 */
export class SyncHub {
  private readonly byUser = new Map<number, Set<Send>>();

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

  notify(userId: number, msg: Extract<ServerMessage, { type: 'sync' }>): void {
    for (const s of this.byUser.get(userId) ?? []) {
      try {
        s(msg);
      } catch {
        // conexão fechando; ignorada
      }
    }
  }
}
