/** Utilitários de calendário. Todo armazenamento é em UTC (ms). */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    partsCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = domingo
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Partes de data/hora locais de um instante UTC no fuso `tz`. */
export function localParts(utcMs: number, tz: string): LocalParts {
  if (tz === 'UTC') {
    const d = new Date(utcMs);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      weekday: d.getUTCDay(),
    };
  }
  const p: Record<string, string> = {};
  for (const part of formatter(tz).formatToParts(new Date(utcMs))) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: WEEKDAYS[p.weekday ?? ''] ?? 0,
  };
}

/**
 * Data local (no fuso da bolsa) como meia-noite UTC — a chave de "data de pregão" (ADR-0006).
 */
export function sessionDate(utcMs: number, tz: string): number {
  const p = localParts(utcMs, tz);
  return Date.UTC(p.year, p.month - 1, p.day);
}

/** Segunda-feira (meia-noite UTC) da semana ISO que contém a data `dateMs` (meia-noite UTC). */
export function weekStart(dateMs: number): number {
  const wd = new Date(dateMs).getUTCDay(); // 0 = domingo
  const offset = (wd + 6) % 7; // segunda = 0
  return dateMs - offset * DAY_MS;
}

/** Primeiro dia do mês (meia-noite UTC) da data `dateMs`. */
export function monthStart(dateMs: number): number {
  const d = new Date(dateMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Converte "HH:MM" em minutos desde a meia-noite. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
