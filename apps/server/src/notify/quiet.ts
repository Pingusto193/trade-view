/** Minutos do dia (0–1439) de um instante no fuso indicado. */
export function minutesInZone(timeMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timeMs));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Horário de silêncio. Aceita faixa que atravessa a meia-noite (ex.: 22:00 → 07:00).
 * Início incluído, fim excluído. Início igual ao fim = silêncio desligado.
 */
export function isQuiet(timeMs: number, start: string, end: string, tz: string): boolean {
  const s = toMin(start);
  const e = toMin(end);
  if (s === e) return false;
  const now = minutesInZone(timeMs, tz);
  return s < e ? now >= s && now < e : now >= s || now < e;
}
