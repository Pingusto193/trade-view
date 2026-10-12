import type { Candle } from '@radar/shared';
import { formatNumber } from '@radar/shared';
import { classifySlope, type SlopeClass } from './pa';
import { DEFAULT_PA, type PaParams } from './params';
import { PivotTracker, type StructureTrend } from './pivots';
import { SeriesBuffer } from './series';

export type MaKey = 'ema9' | 'ema21' | 'sma50' | 'sma100' | 'sma200';
export const MA_NAME: Readonly<Record<MaKey, string>> = {
  ema9: 'MME9',
  ema21: 'MME21',
  sma50: 'MMA50',
  sma100: 'MMA100',
  sma200: 'MMA200',
};

export type TrendLabel = 'alta' | 'baixa' | 'lateral';
export type AdxClass = 'lateral' | 'cinzenta' | 'tendencia' | 'muito-forte';

export interface ContextItem<T> {
  value: T;
  label: string;
  /** "Porquê": quais candles e médias levaram à conclusão (SPEC §9). */
  why: string[];
  refs?: number[];
}

export interface ContextReport {
  index: number;
  time: number;
  trend: ContextItem<TrendLabel>;
  structure: ContextItem<StructureTrend>;
  adx: ContextItem<AdxClass | null>;
  alignment: ContextItem<'alta' | 'baixa' | 'nenhum'>;
  respected: ContextItem<{ ma: MaKey; hits: number; of: number } | null>;
  slopes: ContextItem<Partial<Record<MaKey, SlopeClass | null>>>;
  /** Heurística EXPERIMENTAL. */
  maturity: ContextItem<'jovem' | 'madura' | 'cansada' | 'indefinida'>;
  /** Comparação com a escala maior: a escala maior manda. */
  wind: ContextItem<'a-favor' | 'contra' | 'neutro' | 'sem-dados'>;
}

const f = (n: number, d = 2) => formatNumber(n, d);

const ADX_LABEL: Record<AdxClass, string> = {
  lateral: 'abaixo de 20: lateral — não operar setups de tendência',
  cinzenta: 'entre 20 e 25: zona cinzenta',
  tendencia: 'acima de 25: tendência',
  'muito-forte': 'acima de 40: tendência muito forte',
};

const SLOPE_LABEL: Record<SlopeClass, string> = {
  'acentuada-alta': 'subindo forte',
  'suave-alta': 'subindo',
  plana: 'plana',
  'suave-baixa': 'caindo',
  'acentuada-baixa': 'caindo forte',
  virando: 'virando',
};

export function adxClass(adx: number): AdxClass | null {
  if (!Number.isFinite(adx)) return null;
  if (adx > 40) return 'muito-forte';
  if (adx > 25) return 'tendencia';
  if (adx >= 20) return 'cinzenta';
  return 'lateral';
}

/**
 * Painel de Contexto (SPEC §9) calculado no último candle FECHADO da série.
 * `higherTrend` = tendência da escala maior (do mesmo painel calculado nela), quando disponível.
 */
export function computeContext(
  candles: readonly Candle[],
  opts: {
    pa?: PaParams;
    higherTrend?: TrendLabel | null;
    higherLabel?: string;
    lastIndex?: number;
  } = {},
): ContextReport | null {
  const pa = opts.pa ?? DEFAULT_PA;
  const last = opts.lastIndex ?? candles.length - 1;
  if (last < 30) return null;
  const s = new SeriesBuffer();
  const piv = new PivotTracker(pa.pivotN);
  for (let i = 0; i <= last; i++) {
    s.push(candles[i] as Candle);
    piv.step(s, i);
  }
  const t = last;
  const c = s.c(t);
  const adx = s.v(s.adx, t);
  const ma50Up = s.v(s.sma50, t) > s.v(s.sma50, t - 1);
  const ma50Down = s.v(s.sma50, t) < s.v(s.sma50, t - 1);
  const struct = piv.trend();
  const highs = piv.highs.slice(-2);
  const lows = piv.lows.slice(-2);

  // ---- estrutura
  const structWhy =
    highs.length === 2 && lows.length === 2
      ? [
          `topos: ${f(highs[0]?.price ?? 0)} → ${f(highs[1]?.price ?? 0)}`,
          `fundos: ${f(lows[0]?.price ?? 0)} → ${f(lows[1]?.price ?? 0)}`,
        ]
      : ['ainda não há dois topos e dois fundos confirmados'];

  // ---- tendência (estrutura + MMA50 + ADX)
  let trend: TrendLabel = 'lateral';
  if (adx >= 20 && struct === 'alta' && ma50Up) trend = 'alta';
  else if (adx >= 20 && struct === 'baixa' && ma50Down) trend = 'baixa';
  const trendWhy = [
    `estrutura: ${struct}`,
    `MMA50 ${ma50Up ? 'subindo' : ma50Down ? 'caindo' : 'plana'} (${f(s.v(s.sma50, t))})`,
    `ADX ${f(adx, 1)}`,
  ];

  // ---- alinhamento
  const e9 = s.v(s.ema9, t);
  const e21 = s.v(s.ema21, t);
  const m50 = s.v(s.sma50, t);
  const alignment =
    c.close > e9 && e9 > e21 && e21 > m50
      ? 'alta'
      : c.close < e9 && e9 < e21 && e21 < m50
        ? 'baixa'
        : 'nenhum';

  // ---- média respeitada: últimos até 5 recuos (fundos confirmados) — mínima a até 0,5 ATR e fechamento acima
  const keys: MaKey[] = ['ema9', 'ema21', 'sma50', 'sma100', 'sma200'];
  const recent = piv.lows.slice(-5);
  let best: { ma: MaKey; hits: number; of: number } | null = null;
  const respWhy: string[] = [];
  if (recent.length >= 3) {
    for (const k of keys) {
      let hits = 0;
      for (const p of recent) {
        const ma = s.v(s[k], p.index);
        const atr = s.v(s.atr14, p.index);
        const bar = s.c(p.index);
        if (
          Number.isFinite(ma) &&
          atr > 0 &&
          Math.abs(bar.low - ma) <= 0.5 * atr &&
          bar.close >= ma
        )
          hits++;
      }
      if (hits > 0) respWhy.push(`${MA_NAME[k]}: segurou ${hits} de ${recent.length} recuos`);
      if (hits >= 2 && (!best || hits > best.hits)) best = { ma: k, hits, of: recent.length };
    }
  } else respWhy.push('menos de 3 recuos confirmados para avaliar');

  // ---- inclinações
  const slopes: Partial<Record<MaKey, SlopeClass | null>> = {};
  const slopeWhy: string[] = [];
  for (const k of ['ema9', 'ema21', 'sma50', 'sma200'] as MaKey[]) {
    const cl = classifySlope(s, s[k], t, pa);
    slopes[k] = cl;
    if (cl) slopeWhy.push(`${MA_NAME[k]}: ${SLOPE_LABEL[cl]}`);
  }

  // ---- maturidade (experimental)
  let maturity: 'jovem' | 'madura' | 'cansada' | 'indefinida' = 'indefinida';
  const matWhy: string[] = ['heurística experimental, não validada'];
  if (trend === 'alta') {
    let turnAgo = -1;
    for (let k = t; k > Math.max(2, t - 60); k--) {
      if (s.v(s.sma50, k) > s.v(s.sma50, k - 1) && s.v(s.sma50, k - 1) <= s.v(s.sma50, k - 2)) {
        turnAgo = t - k;
        break;
      }
    }
    let alignedFor = 0;
    for (let k = t; k > 0; k--) {
      const ck = s.c(k);
      if (
        ck.close > s.v(s.ema9, k) &&
        s.v(s.ema9, k) > s.v(s.ema21, k) &&
        s.v(s.ema21, k) > s.v(s.sma50, k)
      )
        alignedFor++;
      else break;
    }
    const dist200 = (c.close - s.v(s.sma200, t)) / s.v(s.atr14, t);
    const slope50 = (s.v(s.sma50, t) - s.v(s.sma50, t - 10)) / s.v(s.atr14, t);
    const slope50prev = (s.v(s.sma50, t - 10) - s.v(s.sma50, t - 20)) / s.v(s.atr14, t);
    if (turnAgo >= 0 && turnAgo <= 20) {
      maturity = 'jovem';
      matWhy.push(`MMA50 virou para cima há ${turnAgo} candles`);
    } else if (Number.isFinite(dist200) && dist200 > 8 && slope50 < slope50prev) {
      maturity = 'cansada';
      matWhy.push(`preço a ${f(dist200, 1)} ATR da MMA200 e MMA50 achatando`);
    } else if (alignedFor >= 30) {
      maturity = 'madura';
      matWhy.push(`médias alinhadas há ${alignedFor} candles`);
    }
  }

  // ---- vento (escala maior manda)
  let wind: 'a-favor' | 'contra' | 'neutro' | 'sem-dados' = 'sem-dados';
  const windWhy: string[] = [];
  if (opts.higherTrend) {
    windWhy.push(
      `escala maior${opts.higherLabel ? ` (${opts.higherLabel})` : ''}: ${opts.higherTrend}`,
    );
    if (opts.higherTrend === 'lateral' || trend === 'lateral') wind = 'neutro';
    else wind = opts.higherTrend === trend ? 'a-favor' : 'contra';
    if (wind === 'contra')
      windWhy.push('ATENÇÃO: operar a favor desta escala é ir contra a escala maior');
  } else windWhy.push('escala maior não carregada');

  const ac = adxClass(adx);
  return {
    index: t,
    time: c.time,
    trend: {
      value: trend,
      label: trend === 'alta' ? 'Alta' : trend === 'baixa' ? 'Baixa' : 'Lateral',
      why: trendWhy,
    },
    structure: {
      value: struct,
      label: struct,
      why: structWhy,
      refs: [...highs, ...lows].map((p) => p.index),
    },
    adx: {
      value: ac,
      label: ac ? `ADX ${f(adx, 1)} — ${ADX_LABEL[ac]}` : 'ADX indisponível',
      why: [`+DI ${f(s.v(s.plusDI, t), 1)}, −DI ${f(s.v(s.minusDI, t), 1)}`],
    },
    alignment: {
      value: alignment,
      label:
        alignment === 'alta'
          ? 'Preço > MME9 > MME21 > MMA50'
          : alignment === 'baixa'
            ? 'Preço < MME9 < MME21 < MMA50'
            : 'Médias desalinhadas',
      why: [`preço ${f(c.close)}`, `MME9 ${f(e9)}`, `MME21 ${f(e21)}`, `MMA50 ${f(m50)}`],
    },
    respected: {
      value: best,
      label: best
        ? `Respeita a ${MA_NAME[best.ma]} (${best.hits} de ${best.of} recuos)`
        : 'Nenhuma média respeitada com clareza',
      why: respWhy,
      refs: recent.map((p) => p.index),
    },
    slopes: { value: slopes, label: slopeWhy.join(' · '), why: slopeWhy },
    maturity: { value: maturity, label: `Maturidade: ${maturity} (experimental)`, why: matWhy },
    wind: {
      value: wind,
      label:
        wind === 'a-favor'
          ? 'Vento a favor'
          : wind === 'contra'
            ? 'Vento CONTRA (escala maior)'
            : wind === 'neutro'
              ? 'Neutro'
              : 'Escala maior sem dados',
      why: windWhy,
    },
  };
}
