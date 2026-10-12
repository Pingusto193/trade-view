import type { Candle, Timeframe } from '@radar/shared';
import { INTRADAY_MS, isIntraday, timeframeRank } from '@radar/shared';
import { monthStart, sessionDate, weekStart } from './time';

/**
 * Agregação de candles (SPEC §6, ADR-0006).
 *
 * Convenções:
 * - Intradiário → intradiário maior: baldes alinhados ao relógio UTC (ex.: 60m = hh:00–hh:59).
 *   Como os fusos usados (São Paulo, Nova York, UTC) têm deslocamento de horas inteiras, isso
 *   equivale a alinhar ao relógio local. Pregões que abrem em hora quebrada (EUA, 9h30) têm o
 *   primeiro candle de 60m "curto" (9h30–10h00), como na Alpaca e no MT5.
 * - Intradiário → diário: agrupa pela data local da bolsa (fuso `tz`).
 * - Diário → semanal: semana ISO, **começa na segunda-feira**. O candle semanal leva a data da
 *   segunda-feira mesmo que ela seja feriado.
 * - Diário → mensal: mês civil; o candle mensal leva a data do dia 1.
 * - Feriados: não geram candle (não há negociação), então não precisam de tratamento especial.
 */

function merge(bucket: Candle | undefined, c: Candle, time: number): Candle {
  if (!bucket)
    return { time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
  bucket.high = Math.max(bucket.high, c.high);
  bucket.low = Math.min(bucket.low, c.low);
  bucket.close = c.close;
  bucket.volume += c.volume;
  return bucket;
}

/** Agrupa candles ordenados por uma função de chave de período. */
export function aggregateBy(candles: readonly Candle[], keyOf: (time: number) => number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | undefined;
  for (const c of candles) {
    const k = keyOf(c.time);
    if (!cur || cur.time !== k) {
      if (cur) out.push(cur);
      cur = undefined;
    }
    cur = merge(cur, c, k);
  }
  if (cur) out.push(cur);
  return out;
}

export function periodKey(target: Timeframe, tz: string): (time: number) => number {
  if (isIntraday(target)) {
    const ms = INTRADAY_MS[target];
    return (t) => Math.floor(t / ms) * ms;
  }
  switch (target) {
    case '1d':
      return (t) => sessionDate(t, tz);
    case '1w':
      return (t) => weekStart(sessionDate(t, tz));
    case '1M':
      return (t) => monthStart(sessionDate(t, tz));
  }
  throw new Error(`escala desconhecida: ${String(target)}`);
}

/**
 * Converte candles de `from` para `to` (maior). Para origem diária ou maior, o `time` já é a
 * data de pregão em meia-noite UTC; por isso o fuso só é usado quando a origem é intradiária.
 */
export function aggregate(
  candles: readonly Candle[],
  from: Timeframe,
  to: Timeframe,
  tz: string,
): Candle[] {
  if (timeframeRank(to) < timeframeRank(from)) {
    throw new RangeError(`não é possível agregar ${from} em ${to} (escala menor)`);
  }
  if (from === to) return candles.map((c) => ({ ...c }));
  const sourceTz = isIntraday(from) ? tz : 'UTC';
  return aggregateBy(candles, periodKey(to, sourceTz));
}

/**
 * Aplica uma atualização de candle (tempo real) a uma série ordenada.
 * - mesmo `time` do último: substitui (candle em formação);
 * - `time` maior: acrescenta;
 * - `time` menor: substitui o candle correspondente se existir (correção tardia), senão ignora.
 * Retorna a mesma série (mutada) para evitar cópias de 10 mil candles a cada tick.
 */
export function upsertCandle(series: Candle[], c: Candle): Candle[] {
  const last = series[series.length - 1];
  if (!last || c.time > last.time) {
    series.push({ ...c });
    return series;
  }
  if (c.time === last.time) {
    series[series.length - 1] = { ...c };
    return series;
  }
  // busca binária
  let lo = 0;
  let hi = series.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = (series[mid] as Candle).time;
    if (t === c.time) {
      series[mid] = { ...c };
      return series;
    }
    if (t < c.time) lo = mid + 1;
    else hi = mid - 1;
  }
  return series;
}

/** Valida e ordena uma série: remove duplicados (mantém o último) e candles inválidos. */
export function sanitizeCandles(candles: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) {
    const ok =
      Number.isFinite(c.time) &&
      [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
      c.high >= c.low &&
      c.high >= Math.max(c.open, c.close) - 1e-12 &&
      c.low <= Math.min(c.open, c.close) + 1e-12 &&
      Number.isFinite(c.volume) &&
      c.volume >= 0;
    if (ok) byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
