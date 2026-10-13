import type { Session, Timeframe } from '@radar/shared';
import { INTRADAY_MS, isIntraday } from '@radar/shared';
import { DAY_MS, hhmmToMinutes, localParts, monthStart, sessionDate, weekStart } from './time';

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

// ------------------------------------------------------------------ períodos fechados (scanner)

/** A data (meia-noite UTC da data local, ADR-0006) é dia de pregão pela sessão da fonte? */
export function isTradingDate(session: Session, date: number): boolean {
  if (!session.days.includes(new Date(date).getUTCDay())) return false;
  return !session.holidays?.includes(new Date(date).toISOString().slice(0, 10));
}

/**
 * Ainda haverá negociação a partir de `now` antes de `until` (data local, exclusiva)? Conta o resto do
 * pregão de hoje (até `close`; sessão sem horário = o dia inteiro) e os dias de pregão seguintes.
 * Feriados fora de `session.holidays` contam como pregão (conservador: o período demora a fechar).
 */
function tradingRemains(session: Session, now: number, until: number): boolean {
  const p = localParts(now, session.timezone);
  const today = Date.UTC(p.year, p.month - 1, p.day);
  if (isTradingDate(session, today)) {
    if (!session.open || !session.close) return true;
    if (p.hour * 60 + p.minute < hhmmToMinutes(session.close)) return true;
  }
  for (let d = today + DAY_MS; d < until; d += DAY_MS) if (isTradingDate(session, d)) return true;
  return false;
}

/**
 * O candle de `tf` com horário `time` (ADR-0006) já FECHOU em `now`? Usa só a sessão informada pela
 * fonte (dias, horário de fechamento e feriados), sem horário de pregão inventado.
 * - intradiário: fechou quando o relógio passa do fim do balde (`time` + duração);
 * - diário: a data local já passou, ou é hoje e o pregão de hoje terminou (sessão 24 h: à meia-noite);
 * - semanal/mensal: a semana (o mês) já virou, ou não resta pregão nenhum até o fim dela(e).
 * Para dados atrasados, passe `now` − atraso: o dado só "enxerga" o mercado até ali.
 */
export function isPeriodClosed(
  tf: Timeframe,
  time: number,
  session: Session,
  now: number,
): boolean {
  if (isIntraday(tf)) return now >= time + INTRADAY_MS[tf];
  const today = sessionDate(now, session.timezone);
  if (tf === '1d') {
    if (today !== time) return today > time;
    return !tradingRemains(session, now, today + DAY_MS);
  }
  if (tf === '1w') {
    const wk = weekStart(today);
    if (wk !== time) return wk > time;
    return !tradingRemains(session, now, wk + 7 * DAY_MS);
  }
  const mo = monthStart(today);
  if (mo !== time) return mo > time;
  const d = new Date(mo);
  return !tradingRemains(session, now, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/**
 * Data de pregão (meia-noite UTC) do último candle DIÁRIO fechado em `now`: hoje, se o pregão de hoje
 * já terminou; senão o último dia de pregão anterior (pula fins de semana e feriados da sessão).
 */
export function lastClosedSession(session: Session, now: number): number {
  let d = sessionDate(now, session.timezone);
  if (isTradingDate(session, d) && isPeriodClosed('1d', d, session, now)) return d;
  for (let i = 0; i < 15; i++) {
    d -= DAY_MS;
    if (isTradingDate(session, d)) return d;
  }
  return d;
}
