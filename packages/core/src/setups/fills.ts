import type { Candle } from '@radar/shared';

/**
 * Modelo de preenchimento conservador (SPEC §12.1). É o MESMO usado pelos detectores, pelo backtest e
 * pelo Modo Treino — o treino nunca pode parecer melhor do que o real.
 *
 * - Entrada por ordem stop: preenche no gatilho; se o candle abrir além dele (gap), na abertura
 *   (sempre o pior preço).
 * - Stop com gap contra: preenche na abertura.
 * - Alvo com gap a favor: preenche no alvo (conservador; abertura como opção).
 * - Stop e alvo tocados no mesmo candle: assume STOP primeiro.
 * - No candle da entrada só o stop é verificado (não dá para saber se o alvo veio depois da entrada).
 */
export type Side = 'buy' | 'sell';

export interface FillOptions {
  /** Alvo com gap a favor: 'target' (conservador, padrão) ou 'open'. */
  targetGap: 'target' | 'open';
}

export const DEFAULT_FILL: FillOptions = { targetGap: 'target' };

/** Ordem stop de entrada. Retorna o preço de execução ou null se não executou. */
export function stopEntryFill(c: Candle, side: Side, level: number): number | null {
  if (side === 'buy') {
    if (c.high < level) return null;
    return Math.max(level, c.open);
  }
  if (c.low > level) return null;
  return Math.min(level, c.open);
}

export interface ExitFill {
  price: number;
  kind: 'stop' | 'alvo';
  /** Execução por gap (na abertura). */
  gap: boolean;
}

/**
 * Saída de uma posição aberta neste candle. `entryBar` = este é o candle da entrada (só stop vale).
 */
export function exitFill(
  c: Candle,
  side: Side,
  stop: number,
  target: number | null,
  entryBar: boolean,
  opts: FillOptions = DEFAULT_FILL,
): ExitFill | null {
  if (side === 'buy') {
    if (!entryBar && c.open <= stop) return { price: c.open, kind: 'stop', gap: true };
    if (!entryBar && target !== null && c.open >= target) {
      return { price: opts.targetGap === 'open' ? c.open : target, kind: 'alvo', gap: true };
    }
    const stopHit = c.low <= stop;
    const targetHit = !entryBar && target !== null && c.high >= target;
    if (stopHit) return { price: stop, kind: 'stop', gap: false };
    if (targetHit) return { price: target as number, kind: 'alvo', gap: false };
    return null;
  }
  if (!entryBar && c.open >= stop) return { price: c.open, kind: 'stop', gap: true };
  if (!entryBar && target !== null && c.open <= target) {
    return { price: opts.targetGap === 'open' ? c.open : target, kind: 'alvo', gap: true };
  }
  const stopHit = c.high >= stop;
  const targetHit = !entryBar && target !== null && c.low <= target;
  if (stopHit) return { price: stop, kind: 'stop', gap: false };
  if (targetHit) return { price: target as number, kind: 'alvo', gap: false };
  return null;
}

/** Arredonda um preço para o tick (para "1 tick acima/abaixo"). */
export function roundTick(price: number, tick: number): number {
  if (!(tick > 0)) return price;
  const decimals = Math.max(0, Math.ceil(-Math.log10(tick)) + 1);
  return Number((Math.round(price / tick) * tick).toFixed(decimals));
}
