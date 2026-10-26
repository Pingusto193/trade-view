/**
 * Formatação no padrão brasileiro (SPEC §3.8): R$ 1.234,56, DD/MM/AAAA, fuso de São Paulo.
 * Armazenamento é sempre em UTC; só a exibição usa o fuso local.
 */
export const DISPLAY_TZ = 'America/Sao_Paulo';

const brlFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(value: number): string {
  if (!Number.isFinite(value)) return '—';
  // Intl usa espaço não separável (U+00A0) entre "R$" e o número; normalizamos para espaço comum.
  return brlFormatter.format(value).replace(/\u00a0/g, ' ');
}

export function formatMoney(value: number, currency: string): string {
  if (!Number.isFinite(value)) return '—';
  if (currency === 'BRL') return formatBRL(value);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency })
    .format(value)
    .replace(/\u00a0/g, ' ');
}

export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Número em PT-BR sem zeros sobrando: 50 → "50"; 0,10 → "0,1"; 1234,5 → "1.234,5". */
export function formatTrim(value: number, maxDecimals = 8): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

export function formatPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${formatNumber(value * 100, decimals)}%`;
}

/** Volume compacto: 1,2 mil / 3,4 mi / 5,6 bi. */
export function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${formatNumber(value / 1e9, 1)} bi`;
  if (abs >= 1e6) return `${formatNumber(value / 1e6, 1)} mi`;
  if (abs >= 1e3) return `${formatNumber(value / 1e3, 1)} mil`;
  return formatNumber(value, 0);
}

function parts(utcMs: number, opts: Intl.DateTimeFormatOptions, tz: string) {
  const fmt = new Intl.DateTimeFormat('pt-BR', { ...opts, timeZone: tz });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) out[p.type] = p.value;
  return out;
}

/** DD/MM/AAAA no fuso informado (padrão: São Paulo). */
export function formatDate(utcMs: number, tz: string = DISPLAY_TZ): string {
  const p = parts(utcMs, { day: '2-digit', month: '2-digit', year: 'numeric' }, tz);
  return `${p.day}/${p.month}/${p.year}`;
}

/** DD/MM/AAAA HH:MM no fuso informado (padrão: São Paulo). */
export function formatDateTime(utcMs: number, tz: string = DISPLAY_TZ): string {
  const p = parts(
    utcMs,
    {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    },
    tz,
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/**
 * Data de um candle diário/semanal/mensal. Esses candles usam "meia-noite UTC da data de pregão"
 * (ADR-0006), então a data é lida em UTC, não convertida para o fuso.
 */
export function formatSessionDate(utcMidnightMs: number): string {
  return formatDate(utcMidnightMs, 'UTC');
}

/** Tempo relativo curto em PT-BR: "há 3 min", "há 2 h", "há 5 dias". */
/** Quanto falta até um instante futuro: "em 5 min", "em 3 h", "em 4 dias". */
export function formatIn(utcMs: number, now: number = Date.now()): string {
  return formatAgo(now, utcMs).replace('há ', 'em ');
}

export function formatAgo(utcMs: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - utcMs) / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}
