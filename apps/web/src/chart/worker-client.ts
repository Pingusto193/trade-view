import type { WorkerIn, WorkerOut } from './indicator-worker';

type Listener = (msg: WorkerOut) => void;

/** Um único worker de indicadores para o app inteiro; mensagens roteadas por chave do gráfico. */
class IndicatorWorkerClient {
  private worker: Worker | null = null;
  private readonly listeners = new Map<string, Listener>();

  private get w(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./indicator-worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (ev: MessageEvent<WorkerOut>) =>
        this.listeners.get(ev.data.key)?.(ev.data);
    }
    return this.worker;
  }

  listen(key: string, fn: Listener): () => void {
    this.listeners.set(key, fn);
    return () => {
      this.listeners.delete(key);
      this.post({ type: 'dispose', key });
    };
  }

  post(msg: WorkerIn): void {
    this.w.postMessage(msg);
  }
}

export const indicatorWorker = new IndicatorWorkerClient();
