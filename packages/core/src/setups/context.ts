import type { Candle } from '@radar/shared';
import { formatNumber } from '@radar/shared';
import { brokeAbove, classifySlope, slope, type SlopeClass } from './pa';
import { DEFAULT_PA, type PaParams } from './params';
import { PivotTracker, type Pivot, type StructureTrend } from './pivots';
import { SeriesBuffer } from './series';

export type MaKey = 'ema9' | 'ema21' | 'sma50' | 'sma100' | 'sma200';
export const MA_NAME: Readonly<Record<MaKey, string>> = {
  ema9: 'MME9',
  ema21: 'MME21',
  sma50: 'MMA50',
  sma100: 'MMA100',
  sma200: 'MMA200',
};

/** 'indefinida' = ainda não há dados para classificar (MMA50, sua inclinação ou ADX inexistentes). */
export type TrendLabel = 'alta' | 'baixa' | 'lateral' | 'indefinida';
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
  wind: ContextItem<'a-favor' | 'contra' | 'neutro' | 'sem-dados'> & {
    /** Lado que vai contra a escala maior quando o vento é "contra" (aviso vermelho só para esse lado). */
    against: 'compras' | 'vendas' | null;
  };
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

/** Leitura da tendência em um candle (estrutura + MMA50 + ADX), com os números que a justificam. */
export interface TrendReading {
  value: TrendLabel;
  structure: StructureTrend;
  adx: number;
  ma50: number;
  ma50Up: boolean;
  ma50Down: boolean;
  /** Inclinação da MMA50 (SPEC §8.1): (MA[t] − MA[t−k]) ÷ ATR14. */
  slope50: number;
  slopeClass: SlopeClass | null;
  /** Faltam dados: MMA50, sua inclinação ou ADX ainda não existem neste candle. */
  insufficient: boolean;
}

/**
 * Tendência no candle t (SPEC §9: estrutura + MMA50 + ADX). É a MESMA regra no painel de contexto e
 * na escala maior do motor de setups.
 * - alta: ADX ≥ 20, estrutura de alta, MMA50 subindo no candle e inclinação (§8.1) ≥ o limite de
 *   "plana" — MMA50 plana é mercado lateral (§8.2), mesmo que tenha subido no último candle;
 * - baixa: espelhado; lateral: o resto;
 * - indefinida: faltam dados (nunca classificar a partir de um número que não existe).
 */
export function classifyTrend(
  s: SeriesBuffer,
  piv: PivotTracker,
  t: number,
  pa: PaParams,
): TrendReading {
  const adx = s.v(s.adx, t);
  const ma50 = s.v(s.sma50, t);
  const prev = s.v(s.sma50, t - 1);
  const slope50 = slope(s, s.sma50, t, pa);
  const structure = piv.trend();
  const insufficient = ![adx, ma50, prev, slope50].every(Number.isFinite);
  const ma50Up = ma50 > prev;
  const ma50Down = ma50 < prev;
  let value: TrendLabel = 'lateral';
  if (insufficient) value = 'indefinida';
  else if (adx >= 20 && structure === 'alta' && ma50Up && slope50 >= pa.flatSlope) value = 'alta';
  else if (adx >= 20 && structure === 'baixa' && ma50Down && slope50 <= -pa.flatSlope)
    value = 'baixa';
  return {
    value,
    structure,
    adx,
    ma50,
    ma50Up,
    ma50Down,
    slope50,
    slopeClass: classifySlope(s, s.sma50, t, pa),
    insufficient,
  };
}

const RESPECT_KEYS: readonly MaKey[] = ['ema9', 'ema21', 'sma50', 'sma100', 'sma200'];

export interface RespectedMa {
  /** Média vencedora (pelo menos 2 acertos; no empate, a mais curta) ou null. */
  best: { ma: MaKey; hits: number; of: number } | null;
  /** Recuos avaliados: até 5 fundos CONFIRMADOS até t, do mais antigo ao mais recente. */
  recent: Pivot[];
  /** Acertos de cada média nos recuos avaliados. */
  hits: Record<MaKey, number>;
}

/**
 * Média respeitada no candle t (SPEC §9): nos últimos 3 a 5 recuos, qual média (9, 21, 50, 100 ou 200)
 * segurou o preço — mínima a até `respectNearAtr` × ATR da média e fechamento acima dela.
 * Função pura e sem look-ahead: só usa fundos já confirmados em t. O painel de contexto e o motor de
 * setups (ctx.respectedMa, usado pelo recuo à média com ma = 'auto') chamam esta mesma função.
 */
export function respectedMaAt(
  s: SeriesBuffer,
  pivots: PivotTracker,
  t: number,
  pa: PaParams,
): RespectedMa {
  const recent: Pivot[] = [];
  const lows = pivots.lows;
  for (let i = lows.length - 1; i >= 0 && recent.length < 5; i--) {
    const p = lows[i] as Pivot;
    if (p.confirmedAt <= t) recent.unshift(p);
  }
  const hits: Record<MaKey, number> = { ema9: 0, ema21: 0, sma50: 0, sma100: 0, sma200: 0 };
  let best: RespectedMa['best'] = null;
  if (recent.length >= 3) {
    for (const k of RESPECT_KEYS) {
      let n = 0;
      for (const p of recent) {
        const ma = s.v(s[k], p.index);
        const atr = s.v(s.atr14, p.index);
        const bar = s.c(p.index);
        if (
          Number.isFinite(ma) &&
          atr > 0 &&
          Math.abs(bar.low - ma) <= pa.respectNearAtr * atr &&
          bar.close >= ma
        )
          n++;
      }
      hits[k] = n;
      if (n >= 2 && (!best || n > best.hits)) best = { ma: k, hits: n, of: recent.length };
    }
  }
  return { best, recent, hits };
}

/** Maturidade: a MMA50 virou "há poucos candles" se foi há até isto (decisão nossa). */
const MATURITY_YOUNG_BARS = 20;
/** Maturidade "cansada": janela da comparação de volume das altas com o das correções (decisão nossa). */
const MATURITY_VOL_BARS = 20;

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
  const tr = classifyTrend(s, piv, t, pa);
  const adx = tr.adx;
  const struct = tr.structure;
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
  const trend = tr.value;
  const trendWhy = tr.insufficient
    ? [
        `dados insuficientes: a MMA50 e sua inclinação precisam de ${50 + pa.slopeLookback} candles (há ${t + 1})`,
        `estrutura: ${struct}`,
        `ADX ${f(adx, 1)}`,
      ]
    : [
        `estrutura: ${struct}`,
        `MMA50 ${tr.ma50Up ? 'subindo' : tr.ma50Down ? 'caindo' : 'parada'} (${f(tr.ma50)}); ` +
          `inclinação ${f(tr.slope50)} ATR em ${pa.slopeLookback} candles` +
          (tr.slopeClass ? ` (${SLOPE_LABEL[tr.slopeClass]})` : '') +
          (Math.abs(tr.slope50) < pa.flatSlope ? ` — plana: abaixo de ${f(pa.flatSlope)}` : ''),
        `ADX ${f(adx, 1)}`,
      ];

  // ---- alinhamento
  const e9 = s.v(s.ema9, t);
  const e21 = s.v(s.ema21, t);
  const m50 = s.v(s.sma50, t);
  const alignData = [e9, e21, m50].every(Number.isFinite);
  const alignment =
    c.close > e9 && e9 > e21 && e21 > m50
      ? 'alta'
      : c.close < e9 && e9 < e21 && e21 < m50
        ? 'baixa'
        : 'nenhum';

  // ---- média respeitada: últimos até 5 recuos (fundos confirmados) — mínima perto da média e fechamento acima
  const resp = respectedMaAt(s, piv, t, pa);
  const recent = resp.recent;
  const best = resp.best;
  const respWhy: string[] = [];
  if (recent.length >= 3) {
    for (const k of RESPECT_KEYS) {
      const hits = resp.hits[k];
      if (hits > 0) respWhy.push(`${MA_NAME[k]}: segurou ${hits} de ${recent.length} recuos`);
    }
    respWhy.push(`critério: mínima a até ${f(pa.respectNearAtr)} ATR da média e fechamento acima`);
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
    // jovem: MMA50 virou há poucos candles E rompeu resistência relevante — o último topo confirmado
    // até o candle da virada, rompido (por fechamento, §8.1) depois de confirmado
    let broke: { price: number; at: number } | null = null;
    if (turnAgo >= 0 && turnAgo <= MATURITY_YOUNG_BARS) {
      const turnIdx = t - turnAgo;
      let res: Pivot | undefined;
      for (let i = piv.highs.length - 1; i >= 0 && !res; i--) {
        const p = piv.highs[i] as Pivot;
        if (p.confirmedAt <= turnIdx) res = p;
      }
      for (let k = res?.confirmedAt ?? t + 1; res && k <= t && !broke; k++)
        if (brokeAbove(s, k, res.price, pa)) broke = { price: res.price, at: k };
      if (!broke)
        matWhy.push(
          res
            ? `MMA50 virou para cima há ${turnAgo} candles, mas ainda não rompeu a resistência ${f(res.price)}`
            : `MMA50 virou para cima há ${turnAgo} candles, mas não há topo anterior para servir de resistência`,
        );
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
    const stretched = Number.isFinite(dist200) && dist200 > 8 && slope50 < slope50prev;
    // cansada: também volume menor nas altas e maior nas correções (últimos candles)
    let upVol = 0;
    let ups = 0;
    let downVol = 0;
    let downs = 0;
    for (let k = Math.max(0, t - MATURITY_VOL_BARS + 1); k <= t; k++) {
      const ck = s.c(k);
      if (ck.close > ck.open) {
        upVol += ck.volume;
        ups++;
      } else if (ck.close < ck.open) {
        downVol += ck.volume;
        downs++;
      }
    }
    const upAvg = ups ? upVol / ups : Number.NaN;
    const downAvg = downs ? downVol / downs : Number.NaN;
    const volWeak = upAvg < downAvg;
    if (broke) {
      maturity = 'jovem';
      matWhy.push(
        `MMA50 virou para cima há ${turnAgo} candles`,
        `rompeu a resistência ${f(broke.price)} por fechamento`,
      );
    } else if (stretched && volWeak) {
      maturity = 'cansada';
      matWhy.push(
        `preço a ${f(dist200, 1)} ATR da MMA200 e MMA50 achatando`,
        `volume menor nas altas (${f(upAvg, 0)}) que nas correções (${f(downAvg, 0)}) nos últimos ${MATURITY_VOL_BARS} candles`,
      );
    } else if (alignedFor >= 30) {
      maturity = 'madura';
      matWhy.push(`médias alinhadas há ${alignedFor} candles`);
    }
    if (stretched && !volWeak)
      matWhy.push(
        `preço a ${f(dist200, 1)} ATR da MMA200 e MMA50 achatando, mas o volume das altas não é menor que o das correções`,
      );
  }

  // ---- vento (escala maior manda). Compra com a escala maior em baixa = aviso vermelho, qualquer que
  // seja a tendência desta escala (SPEC §9). Com a maior em alta, é "contra" quando esta está em baixa.
  let wind: 'a-favor' | 'contra' | 'neutro' | 'sem-dados' = 'sem-dados';
  let windFor: 'compras' | 'vendas' = 'compras';
  const windWhy: string[] = [];
  const higher = opts.higherTrend && opts.higherTrend !== 'indefinida' ? opts.higherTrend : null;
  if (higher) {
    windWhy.push(`escala maior${opts.higherLabel ? ` (${opts.higherLabel})` : ''}: ${higher}`);
    if (higher === 'baixa') {
      wind = 'contra';
      windWhy.push('ATENÇÃO: compras nesta escala vão contra a escala maior (aviso vermelho)');
      if (trend === 'baixa') windWhy.push('vendas estariam a favor da escala maior');
    } else if (higher === 'lateral' || trend === 'lateral' || trend === 'indefinida') {
      wind = 'neutro';
    } else if (higher === trend) {
      wind = 'a-favor';
    } else {
      wind = 'contra';
      windFor = 'vendas';
      windWhy.push('ATENÇÃO: operar a favor desta escala (vender) é ir contra a escala maior');
    }
  } else windWhy.push('escala maior não carregada');

  const ac = adxClass(adx);
  return {
    index: t,
    time: c.time,
    trend: {
      value: trend,
      label:
        trend === 'alta'
          ? 'Alta'
          : trend === 'baixa'
            ? 'Baixa'
            : trend === 'lateral'
              ? 'Lateral'
              : 'Indefinida (dados insuficientes)',
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
      label: !alignData
        ? 'Sem dados suficientes (a MMA50 precisa de 50 candles)'
        : alignment === 'alta'
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
            ? `Vento CONTRA para ${windFor} (escala maior em ${higher ?? '—'})`
            : wind === 'neutro'
              ? 'Neutro'
              : 'Escala maior sem dados',
      why: windWhy,
      against: wind === 'contra' ? windFor : null,
    },
  };
}
