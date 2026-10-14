import { localParts } from '@radar/core';
import type { Session } from '@radar/shared';

/**
 * Relógio do servidor da corretora no MetaTrader 5 (DATA_SOURCES §16, ADR-0023).
 *
 * O MT5 entrega os horários das barras como segundos "no relógio do servidor" (relatos no fórum
 * MQL5 mostram UTC+2/UTC+3 em corretoras de forex), e não há função que informe esse fuso. O agente
 * manda o fuso configurado e a diferença medida pelos ticks; aqui decidimos como converter para UTC.
 */
export type Mt5Clock =
  /** Diferença fixa para o UTC (minutos; UTC+3 = 180). */
  | { kind: 'fixed'; offsetMin: number }
  /** Fuso IANA + deslocamento extra (o padrão "NY+7" = Nova York + 7 h, com o horário de verão dos EUA). */
  | { kind: 'zone'; tz: string; shiftMin: number };

export interface ResolvedClock {
  clock: Mt5Clock;
  /** Como o horário foi decidido. */
  source: 'config' | 'detected' | 'default-b3' | 'unknown';
  /** Texto curto para a tela, ex.: "UTC+3 (medido pelos ticks)". */
  label: string;
  /** Avisos honestos sobre a conversão. */
  notes: string[];
}

const MINUTE = 60_000;
const NY = 'America/New_York';
const SAO_PAULO = 'America/Sao_Paulo';

/** Deslocamento (minutos) de um fuso IANA num instante UTC. */
export function zoneOffsetMin(tz: string, utcMs: number): number {
  const t = Math.floor(utcMs / MINUTE) * MINUTE;
  const p = localParts(t, tz);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t) / MINUTE);
}

export function clockOffsetMin(clock: Mt5Clock, utcMs: number): number {
  return clock.kind === 'fixed' ? clock.offsetMin : zoneOffsetMin(clock.tz, utcMs) + clock.shiftMin;
}

/**
 * Converte um horário de parede do servidor (ms, lido "como se fosse UTC") no instante UTC real.
 * Na hora repetida da volta do horário de verão vale a primeira leitura (ambiguidade inevitável).
 */
export function serverWallToUtc(wallMs: number, clock: Mt5Clock): number {
  if (clock.kind === 'fixed') return wallMs - clock.offsetMin * MINUTE;
  const guess = wallMs - clockOffsetMin(clock, wallMs) * MINUTE;
  return wallMs - clockOffsetMin(clock, guess) * MINUTE;
}

function isIana(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Lê o `server_timezone` do agente: 'auto', 'NY+7', 'UTC', 'UTC+02:00', 'UTC-3', 'GMT+2' ou um nome
 * IANA. Devolve null se não entender (o chamador avisa e usa 'auto').
 */
export function parseServerTz(text: string): Mt5Clock | 'auto' | null {
  const s = text.trim();
  if (s === '' || s.toLowerCase() === 'auto') return 'auto';
  if (/^NY\s*\+\s*7$/i.test(s)) return { kind: 'zone', tz: NY, shiftMin: 7 * 60 };
  if (/^(UTC|GMT)$/i.test(s)) return { kind: 'fixed', offsetMin: 0 };
  const m = /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(s);
  if (m) {
    const h = Number(m[2]);
    const min = Number(m[3] ?? 0);
    if (h > 14 || min >= 60) return null;
    return { kind: 'fixed', offsetMin: (m[1] === '-' ? -1 : 1) * (h * 60 + min) };
  }
  if (s.includes('/') && isIana(s)) return { kind: 'zone', tz: s, shiftMin: 0 };
  return null;
}

export function formatOffset(min: number): string {
  if (min === 0) return 'UTC';
  const sign = min > 0 ? '+' : '−';
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

export function describeClock(clock: Mt5Clock, now: number): string {
  if (clock.kind === 'fixed') return formatOffset(clock.offsetMin);
  const now_ = formatOffset(clockOffsetMin(clock, now));
  if (clock.tz === NY && clock.shiftMin === 420) return `NY+7 (${now_} agora)`;
  if (clock.tz === SAO_PAULO && clock.shiftMin === 0) return `horário de Brasília (${now_})`;
  return `${clock.tz}${clock.shiftMin ? ` ${formatOffset(clock.shiftMin)}` : ''} (${now_} agora)`;
}

const DST_NOTE =
  'Se a corretora muda o relógio no horário de verão, barras intradiárias de antes da mudança podem ' +
  'ficar 1 h deslocadas: informe server_timezone na configuração do agente (docs/GUIA_MT5.md).';

/**
 * Decide como converter os horários de um agente.
 * - Configuração explícita vale; se o tick mostrar outra diferença, avisa.
 * - 'auto' com medida pelos ticks: B3 com UTC−3 → horário de Brasília; diferença igual à de "NY+7"
 *   → esse padrão (o mais citado no forex, não verificado); senão diferença fixa.
 * - 'auto' sem medida: B3 → supõe Brasília; forex → UTC, com aviso de que pode estar deslocado.
 */
export function resolveClock(
  serverTz: string,
  detectedOffsetMin: number | null,
  mostlyB3: boolean,
  now: number,
): ResolvedClock {
  const notes: string[] = [];
  let parsed = parseServerTz(serverTz);
  if (parsed === null) {
    notes.push(`Fuso "${serverTz}" da configuração do agente não foi entendido; usando "auto".`);
    parsed = 'auto';
  }
  if (parsed !== 'auto') {
    const off = clockOffsetMin(parsed, now);
    if (detectedOffsetMin !== null && detectedOffsetMin !== off) {
      notes.push(
        `O fuso configurado (${formatOffset(off)} agora) não bate com o medido pelos ticks ` +
          `(${formatOffset(detectedOffsetMin)}): confira server_timezone no agente.`,
      );
    }
    return {
      clock: parsed,
      source: 'config',
      label: `${describeClock(parsed, now)} (configurado no agente)`,
      notes,
    };
  }
  if (detectedOffsetMin !== null) {
    const sp: Mt5Clock = { kind: 'zone', tz: SAO_PAULO, shiftMin: 0 };
    const ny7: Mt5Clock = { kind: 'zone', tz: NY, shiftMin: 420 };
    if (mostlyB3 && detectedOffsetMin === clockOffsetMin(sp, now)) {
      return {
        clock: sp,
        source: 'detected',
        label: `${describeClock(sp, now)} (medido pelos ticks)`,
        notes,
      };
    }
    if (!mostlyB3 && detectedOffsetMin === clockOffsetMin(ny7, now)) {
      notes.push(
        'Diferença medida pelos ticks igual à do padrão "NY+7" (fechamento de Nova York); o Radar supõe ' +
          'que a corretora segue o horário de verão dos EUA. ' +
          DST_NOTE,
      );
      return {
        clock: ny7,
        source: 'detected',
        label: `${describeClock(ny7, now)} (medido pelos ticks)`,
        notes,
      };
    }
    notes.push(DST_NOTE);
    const fixed: Mt5Clock = { kind: 'fixed', offsetMin: detectedOffsetMin };
    return {
      clock: fixed,
      source: 'detected',
      label: `${formatOffset(detectedOffsetMin)} (medido pelos ticks)`,
      notes,
    };
  }
  if (mostlyB3) {
    notes.push(
      'Fuso do servidor suposto: horário de Brasília (ainda sem ticks recentes para conferir).',
    );
    const sp: Mt5Clock = { kind: 'zone', tz: SAO_PAULO, shiftMin: 0 };
    return { clock: sp, source: 'default-b3', label: `${describeClock(sp, now)} (suposto)`, notes };
  }
  notes.push(
    'Fuso do servidor da corretora DESCONHECIDO (mercado parado e sem configuração): os horários ' +
      'intradiários podem estar deslocados. Informe server_timezone no agente.',
  );
  return {
    clock: { kind: 'fixed', offsetMin: 0 },
    source: 'unknown',
    label: 'UTC (suposto)',
    notes,
  };
}

/** Fuso IANA cuja meia-noite coincide (agora) com a virada do dia no servidor; null se não houver. */
export function sessionTimezone(clock: Mt5Clock, now: number): string | null {
  if (clock.kind === 'zone' && clock.shiftMin === 0) return clock.tz;
  const off = clockOffsetMin(clock, now);
  if (off % 60 !== 0 || Math.abs(off) > 12 * 60) return null;
  const h = off / 60;
  // Nos fusos "Etc/GMT" o sinal é invertido: Etc/GMT-3 = UTC+3.
  return h === 0 ? 'UTC' : `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * Sessão do forex (domingo 17:00 → sexta 17:00 em Nova York, 🟡 DATA_SOURCES §5) escrita no relógio do
 * servidor da corretora, para que o dia do candle diário (que vira à meia-noite do servidor) e a
 * sessão concordem. Calculada para `now` (muda com o horário de verão; o adaptador renova o meta).
 */
export function forexSession(clock: Mt5Clock, now: number): { session: Session; exact: boolean } {
  const tz = sessionTimezone(clock, now);
  if (!tz) {
    return {
      session: {
        timezone: NY,
        days: [1, 2, 3, 4, 5],
        weekly: { openDay: 0, openTime: '17:00', closeDay: 5, closeTime: '17:00' },
      },
      exact: false,
    };
  }
  const WEEK = 7 * 1440;
  const diff = zoneOffsetMin(tz, now) - zoneOffsetMin(NY, now);
  const at = (day: number) => (((day * 1440 + 17 * 60 + diff) % WEEK) + WEEK) % WEEK;
  const open = at(0);
  const close = at(5);
  return {
    session: {
      timezone: tz,
      days: [1, 2, 3, 4, 5],
      weekly: {
        openDay: Math.floor(open / 1440),
        openTime: hhmm(open % 1440),
        closeDay: Math.floor(close / 1440),
        closeTime: hhmm(close % 1440),
      },
    },
    exact: true,
  };
}
