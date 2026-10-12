import type { Timeframe } from '@radar/shared';
import { isIntraday } from '@radar/shared';

export { aggregate, sessionDate } from '@radar/core';

export function isIntradayTf(tf: Timeframe): boolean {
  return isIntraday(tf);
}
