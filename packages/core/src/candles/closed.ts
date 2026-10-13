import type { Candle, Session, Timeframe } from '@radar/shared';
import { aggregate } from './aggregate';
import { isPeriodClosed } from './session';

/**
 * Só os candles FECHADOS em `now` (SPEC §3.5): corta no primeiro candle ainda em formação ou futuro.
 * O fechamento é monotônico no tempo, então basta olhar do fim para o começo.
 */
export function closedCandles(
  candles: readonly Candle[],
  tf: Timeframe,
  session: Session,
  now: number,
): Candle[] {
  let n = candles.length;
  while (n > 0 && !isPeriodClosed(tf, (candles[n - 1] as Candle).time, session, now)) n--;
  return candles.slice(0, n);
}

/**
 * Semanal montado a partir do diário FECHADO (semana ISO, ADR-0006). A semana em andamento fica de
 * fora até não restar pregão nela (mesmo critério de `isPeriodClosed`).
 */
export function weeklyFromDaily(
  closedDaily: readonly Candle[],
  session: Session,
  now: number,
): Candle[] {
  return closedCandles(aggregate(closedDaily, '1d', '1w', 'UTC'), '1w', session, now);
}
