import type { Candle } from '@radar/shared';

/**
 * E7 (SPEC §12.4), lado "ingênuo": comprar no primeiro FECHAMENTO a −X% do topo de 52 candles e
 * segurar por `hold` candles, sem stop. Serve de comparação para a Reflexividade (que espera o pivô
 * de alta). Cada queda conta uma vez: só volta a valer quando o topo de 52 candles passar do topo da
 * queda já comprada.
 */
export interface DrawdownBuy {
  index: number;
  time: number;
  price: number;
  /** Retorno ao fim do período segurado (ou no último candle, se os dados acabarem antes). */
  ret: number;
  /** Pior queda adicional durante o período segurado (fração do preço de compra, ≤ 0). */
  worst: number;
  /** Candles efetivamente segurados. */
  held: number;
}

export function drawdownBuys(
  candles: readonly Candle[],
  opts: { minDrawdown?: number; lookback?: number; hold?: number } = {},
): DrawdownBuy[] {
  const dd = opts.minDrawdown ?? 0.5;
  const lb = opts.lookback ?? 52;
  const hold = opts.hold ?? 52;
  const out: DrawdownBuy[] = [];
  let armedPeak = -Infinity; // topo da queda já comprada (evita comprar a mesma queda de novo)
  for (let t = 0; t < candles.length; t++) {
    let peak = -Infinity;
    for (let i = Math.max(0, t - lb + 1); i <= t; i++) peak = Math.max(peak, candles[i]!.high);
    const c = candles[t]!;
    if (peak > armedPeak && c.close <= peak * (1 - dd)) {
      armedPeak = peak;
      const end = Math.min(candles.length - 1, t + hold);
      let worst = 0;
      for (let i = t + 1; i <= end; i++) worst = Math.min(worst, candles[i]!.low / c.close - 1);
      out.push({
        index: t,
        time: c.time,
        price: c.close,
        ret: candles[end]!.close / c.close - 1,
        worst,
        held: end - t,
      });
    }
  }
  return out;
}
