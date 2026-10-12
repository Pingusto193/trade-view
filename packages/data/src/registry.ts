import type { SymbolSearchResult } from '@radar/shared';
import { AlpacaAdapter } from './adapters/alpaca';
import { BinanceAdapter } from './adapters/binance';
import { BrapiAdapter } from './adapters/brapi';
import { SimulatedAdapter } from './adapters/simulated';
import { parseSymbolId, type MarketDataAdapter } from './types';

export interface DataConfig {
  alpacaKeyId?: string;
  alpacaSecretKey?: string;
  brapiToken?: string;
  /** Liga o adaptador de dados simulados (somente desenvolvimento). */
  simulated?: boolean;
}

/** Conjunto de fontes de dados ativas. */
export class AdapterRegistry {
  private readonly byId = new Map<string, MarketDataAdapter>();

  constructor(adapters: readonly MarketDataAdapter[]) {
    for (const a of adapters) this.byId.set(a.id, a);
  }

  static fromConfig(cfg: DataConfig): AdapterRegistry {
    const list: MarketDataAdapter[] = [
      new BinanceAdapter(),
      new AlpacaAdapter({
        ...(cfg.alpacaKeyId ? { keyId: cfg.alpacaKeyId } : {}),
        ...(cfg.alpacaSecretKey ? { secretKey: cfg.alpacaSecretKey } : {}),
      }),
      new BrapiAdapter({ ...(cfg.brapiToken ? { token: cfg.brapiToken } : {}) }),
    ];
    if (cfg.simulated) list.push(new SimulatedAdapter());
    return new AdapterRegistry(list);
  }

  get all(): MarketDataAdapter[] {
    return [...this.byId.values()];
  }

  get(id: string): MarketDataAdapter | undefined {
    return this.byId.get(id);
  }

  /** Resolve "binance:BTCUSDT" no adaptador e no código. */
  resolve(symbolId: string): { adapter: MarketDataAdapter; symbol: string } {
    const { source, symbol } = parseSymbolId(symbolId);
    const adapter = this.byId.get(source);
    if (!adapter) throw new Error(`fonte desconhecida: ${source}`);
    return { adapter, symbol };
  }

  /** Busca unificada entre mercados (SPEC §7). */
  async search(text: string): Promise<SymbolSearchResult[]> {
    const results = await Promise.allSettled(this.all.map((a) => a.searchSymbols(text)));
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).slice(0, 50);
  }
}
