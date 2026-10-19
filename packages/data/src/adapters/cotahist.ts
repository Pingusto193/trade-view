import type { Candle } from '@radar/shared';

/**
 * Leitor do arquivo de Séries Históricas da B3 (COTAHIST). Ver docs/DATA_SOURCES.md §4.
 *
 * Registros de largura fixa (245 bytes). Posições (1-indexadas, inclusivas) conforme o layout
 * "SeriesHistoricas_Layout.pdf" da B3. Conferidas com o arquivo REAL de 16/10/2026 (teste em
 * `test/live.test.ts`, workflow "Dados reais"): PETR4 igual à brapi e preço médio coerente. FATCOT,
 * CODBDI e ESPECI não foram conferidos (a PETR4 tem fator 1).
 *
 * IMPORTANTE: os preços do COTAHIST **não são ajustados** por proventos e desdobramentos.
 */
const F = {
  TIPREG: [1, 2],
  DATA: [3, 10],
  CODBDI: [11, 12],
  CODNEG: [13, 24],
  TPMERC: [25, 27],
  NOMRES: [28, 39],
  ESPECI: [40, 49],
  PREABE: [57, 69],
  PREMAX: [70, 82],
  PREMIN: [83, 95],
  PREULT: [109, 121],
  TOTNEG: [148, 152],
  QUATOT: [153, 170],
  VOLTOT: [171, 188],
  FATCOT: [211, 217],
} as const;

function field(line: string, f: readonly [number, number]): string {
  return line.slice(f[0] - 1, f[1]);
}

export interface CotahistRecord {
  ticker: string;
  name: string;
  date: number; // meia-noite UTC
  candle: Candle;
  trades: number;
  financialVolume: number; // R$
  /** Mercado: "010" à vista (lote padrão), "020" fracionário. */
  market: string;
  bdi: string;
}

export function parseCotahistLine(line: string): CotahistRecord | null {
  if (line.length < 217 || field(line, F.TIPREG) !== '01') return null;
  const d = field(line, F.DATA);
  const date = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  const fat = Number(field(line, F.FATCOT)) || 1;
  const price = (f: readonly [number, number]) => Number(field(line, f)) / 100 / fat;
  return {
    ticker: field(line, F.CODNEG).trim(),
    name: field(line, F.NOMRES).trim(),
    date,
    candle: {
      time: date,
      open: price(F.PREABE),
      high: price(F.PREMAX),
      low: price(F.PREMIN),
      close: price(F.PREULT),
      volume: Number(field(line, F.QUATOT)),
    },
    trades: Number(field(line, F.TOTNEG)),
    financialVolume: Number(field(line, F.VOLTOT)) / 100,
    market: field(line, F.TPMERC),
    bdi: field(line, F.CODBDI),
  };
}

/**
 * Lê o conteúdo de um COTAHIST e devolve os candles diários do mercado à vista (lote padrão),
 * agrupados por código. `tickers` filtra (opcional).
 */
export function parseCotahist(text: string, tickers?: ReadonlySet<string>): Map<string, Candle[]> {
  const out = new Map<string, Candle[]>();
  for (const raw of text.split(/\r?\n/)) {
    const r = parseCotahistLine(raw);
    if (!r || r.market !== '010') continue;
    if (tickers && !tickers.has(r.ticker)) continue;
    let arr = out.get(r.ticker);
    if (!arr) {
      arr = [];
      out.set(r.ticker, arr);
    }
    arr.push(r.candle);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * Detecta prováveis desdobramentos/grupamentos numa série não ajustada: variação de abertura
 * contra o fechamento anterior maior que `threshold` (padrão 35%). Serve para avisar o usuário,
 * não para ajustar automaticamente.
 */
export function suspiciousGaps(candles: readonly Candle[], threshold = 0.35): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1] as Candle;
    const cur = candles[i] as Candle;
    if (Math.abs(cur.open / prev.close - 1) > threshold) out.push(cur.time);
  }
  return out;
}
