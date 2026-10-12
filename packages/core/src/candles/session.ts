import type { Session } from '@radar/shared';
import { hhmmToMinutes, localParts } from './time';

export type MarketState = 'open' | 'closed' | 'pre-open';

export const MARKET_STATE_LABEL: Readonly<Record<MarketState, string>> = {
  open: 'Aberto',
  closed: 'Fechado',
  'pre-open': 'Pré-abertura',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Estado do mercado num instante (SPEC §6 — "estado do mercado").
 * Limitação: feriados só são considerados se estiverem em `session.holidays`.
 */
export function marketState(session: Session, nowUtc: number): MarketState {
  const p = localParts(nowUtc, session.timezone);
  const minutes = p.hour * 60 + p.minute;

  if (session.weekly) {
    const w = session.weekly;
    // minutos desde domingo 00:00 local
    const nowW = p.weekday * 1440 + minutes;
    const openW = w.openDay * 1440 + hhmmToMinutes(w.openTime);
    const closeW = w.closeDay * 1440 + hhmmToMinutes(w.closeTime);
    const inside =
      openW <= closeW ? nowW >= openW && nowW < closeW : nowW >= openW || nowW < closeW;
    return inside ? 'open' : 'closed';
  }

  const dateKey = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  if (session.holidays?.includes(dateKey)) return 'closed';
  if (!session.days.includes(p.weekday)) return 'closed';
  if (!session.open || !session.close) return 'open'; // 24h

  const open = hhmmToMinutes(session.open);
  const close = hhmmToMinutes(session.close);
  if (minutes >= open && minutes < close) return 'open';
  if (session.preOpen && minutes >= hhmmToMinutes(session.preOpen) && minutes < open) {
    return 'pre-open';
  }
  return 'closed';
}
