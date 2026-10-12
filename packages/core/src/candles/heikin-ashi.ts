import type { Candle } from '@radar/shared';

/**
 * Heikin-Ashi (opção de exibição, SPEC §7). **Só para visualização**: os detectores e o backtest
 * sempre usam os candles reais, porque os preços do Heikin-Ashi não são negociáveis.
 */
export function heikinAshi(candles: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  let prevOpen = Number.NaN;
  let prevClose = Number.NaN;
  for (const c of candles) {
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = Number.isNaN(prevOpen) ? (c.open + c.close) / 2 : (prevOpen + prevClose) / 2;
    out.push({
      time: c.time,
      open,
      close,
      high: Math.max(c.high, open, close),
      low: Math.min(c.low, open, close),
      volume: c.volume,
    });
    prevOpen = open;
    prevClose = close;
  }
  return out;
}
