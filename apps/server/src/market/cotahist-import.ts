import { parseCotahist, suspiciousGaps } from '@radar/data';
import { unzipSync } from 'fflate';
import type { CandleStore } from './candle-store';
import { cotahistId } from './service';

export interface ImportResult {
  tickers: number;
  candles: number;
  /** Datas com gap suspeito (provável desdobramento/grupamento) por código. */
  suspicious: Record<string, number[]>;
}

/** Extrai o texto do COTAHIST de um .ZIP ou de um .TXT (codificação latin1). */
export function cotahistText(bytes: Uint8Array): string {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  let raw = bytes;
  if (isZip) {
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((n) => /cotahist/i.test(n)) ?? Object.keys(files)[0];
    if (!name) throw new Error('ZIP do COTAHIST vazio');
    raw = files[name] as Uint8Array;
  }
  return new TextDecoder('latin1').decode(raw);
}

/**
 * Importa um arquivo COTAHIST para o cache (`cotahist:<código>`, escala 1d).
 * Os preços NÃO são ajustados por proventos (ADR-0009).
 */
export function importCotahist(
  store: CandleStore,
  bytes: Uint8Array,
  tickers?: ReadonlySet<string>,
): ImportResult {
  const byTicker = parseCotahist(cotahistText(bytes), tickers);
  let candles = 0;
  const suspicious: Record<string, number[]> = {};
  for (const [ticker, list] of byTicker) {
    store.save(cotahistId(ticker), '1d', list);
    candles += list.length;
    const gaps = suspiciousGaps(list);
    if (gaps.length) suspicious[ticker] = gaps;
  }
  return { tickers: byTicker.size, candles, suspicious };
}
