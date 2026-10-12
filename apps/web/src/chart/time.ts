import type { Timeframe } from '@radar/shared';
import { DISPLAY_TZ, isIntraday } from '@radar/shared';
import type { UTCTimestamp } from 'lightweight-charts';

/**
 * A Lightweight Charts desenha o eixo de tempo em UTC. Para exibir horários de São Paulo (SPEC §3.8),
 * os candles intradiários são deslocados pelo fuso antes de ir ao gráfico. Diário/semanal/mensal já
 * são "datas" (meia-noite UTC da data de pregão) e não são deslocados.
 */
const offsetCache = new Map<number, number>();
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Deslocamento (ms) de São Paulo em relação ao UTC no instante dado. */
export function tzOffsetMs(utcMs: number): number {
  const hourKey = Math.floor(utcMs / 3_600_000);
  const hit = offsetCache.get(hourKey);
  if (hit !== undefined) return hit;
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    p.year ?? 1970,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
  );
  const off = asUtc - Math.floor(utcMs / 60_000) * 60_000;
  offsetCache.set(hourKey, off);
  return off;
}

export function toChartTime(utcMs: number, tf: Timeframe): UTCTimestamp {
  const ms = isIntraday(tf) ? utcMs + tzOffsetMs(utcMs) : utcMs;
  return Math.floor(ms / 1000) as UTCTimestamp;
}

export function fromChartTime(t: number, tf: Timeframe): number {
  const ms = t * 1000;
  return isIntraday(tf) ? ms - tzOffsetMs(ms) : ms;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Rótulo completo (crosshair): DD/MM/AAAA e, no intradiário, HH:MM. */
export function chartTimeLabel(t: number, tf: Timeframe): string {
  const d = new Date(t * 1000);
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return isIntraday(tf) ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
}

/** Rótulo curto das marcas do eixo. tickType: 0 ano, 1 mês, 2 dia, 3 hora, 4 hora com segundos. */
export function tickLabel(t: number, tickType: number): string {
  const d = new Date(t * 1000);
  switch (tickType) {
    case 0:
      return String(d.getUTCFullYear());
    case 1:
      return MONTHS[d.getUTCMonth()] ?? '';
    case 2:
      return `${d.getUTCDate()}/${pad(d.getUTCMonth() + 1)}`;
    default:
      return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
}
