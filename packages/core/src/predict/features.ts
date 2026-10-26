import type { Candle } from '@radar/shared';
import { BollingerStream } from '../indicators/volatility';
import { RsiStream } from '../indicators/oscillators';
import { slope } from '../setups/pa';
import type { PaParams } from '../setups/params';
import type { SeriesBuffer } from '../setups/series';
import type { TrendLabel } from '../setups/context';
import type { Situation } from './situation';

/**
 * Features da camada 2 (SPEC §23.2): só números do `packages/core`, sem escala de preço (retornos e
 * distâncias em ATR), para valer em qualquer ativo. Nada olha para depois do candle t.
 */
export const FEATURE_NAMES = [
  'ret1',
  'ret5',
  'ret20',
  'dist20',
  'dist50',
  'dist200',
  'slope50',
  'adx',
  'di',
  'rsi',
  'pctB',
  'bbWidth',
  'atrPct',
  'volume',
  'trend',
  'trend2',
  'trend3',
  'setup',
  'news',
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

export const FEATURE_LABEL: Readonly<Record<FeatureName, string>> = {
  ret1: 'Variação do último candle (em ATR)',
  ret5: 'Variação dos últimos 5 candles (em ATR)',
  ret20: 'Variação dos últimos 20 candles (em ATR)',
  dist20: 'Distância da MMA20 (em ATR)',
  dist50: 'Distância da MMA50 (em ATR)',
  dist200: 'Distância da MMA200 (em ATR)',
  slope50: 'Inclinação da MMA50',
  adx: 'ADX',
  di: 'DI+ menos DI−',
  rsi: 'IFR (RSI 14)',
  pctB: 'Posição na Bollinger (%B)',
  bbWidth: 'Largura da Bollinger',
  atrPct: 'Volatilidade (ATR ÷ preço)',
  volume: 'Volume ÷ média de 21',
  trend: 'Tendência nesta escala',
  trend2: 'Tendência na escala maior',
  trend3: 'Tendência na escala maior ainda',
  setup: 'Sinal de setup',
  news: 'Notícias do ativo (contagem recente)',
};

const trendNum = (t: TrendLabel) => (t === 'alta' ? 1 : t === 'baixa' ? -1 : 0);

/**
 * Calcula o vetor de features candle a candle. Usa a série do motor de setups (a mesma da situação) e
 * acrescenta IFR e %B. Devolve null enquanto algum indicador não existe (aquecimento).
 */
export class FeatureTracker {
  private readonly rsi = new RsiStream(14);
  private readonly bb = new BollingerStream(20, 2);

  constructor(
    private readonly pa: PaParams,
    /** Notícias associadas ao ativo antes do instante (contagem). Ausente = 0 (feature desligada). */
    private readonly newsAt?: (time: number) => number,
  ) {}

  push(c: Candle, s: Situation, series: SeriesBuffer): number[] | null {
    const t = series.length - 1;
    const r = this.rsi.next(c.close);
    const b = this.bb.next(c.close);
    const atr = series.v(series.atr14, t);
    const past = (k: number) => series.candles[t - k]?.close ?? Number.NaN;
    const ret = (k: number) => Math.log(c.close / past(k)) / (atr / c.close);
    const dist = (ma: readonly number[]) => (c.close - series.v(ma, t)) / atr;
    const volAvg = series.v(series.volSma21, t);
    const x = [
      ret(1),
      ret(5),
      ret(20),
      dist(series.sma20),
      dist(series.sma50),
      dist(series.sma200),
      slope(series, series.sma50, t, this.pa),
      series.v(series.adx, t) / 100,
      (series.v(series.plusDI, t) - series.v(series.minusDI, t)) / 100,
      (r - 50) / 50,
      b.upper > b.lower ? (c.close - b.lower) / (b.upper - b.lower) - 0.5 : Number.NaN,
      Math.log(series.v(series.bb2Width, t)),
      Math.log(atr / c.close),
      Math.log((c.volume + 1) / ((Number.isFinite(volAvg) ? volAvg : 0) + 1)),
      trendNum(s.trend),
      trendNum(s.trend2),
      trendNum(s.trend3),
      s.setup === 'compra' ? 1 : s.setup === 'venda' ? -1 : 0,
      this.newsAt ? Math.log1p(this.newsAt(c.time)) : 0,
    ];
    return x.every(Number.isFinite) ? x : null;
  }
}
