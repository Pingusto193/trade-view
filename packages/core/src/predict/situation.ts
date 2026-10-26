import type { Candle, Timeframe } from '@radar/shared';
import { TIMEFRAME_LABEL, higherTimeframe } from '@radar/shared';
import { BollingerStream } from '../indicators/volatility';
import { adxClass, classifyTrend, type AdxClass, type TrendLabel } from '../setups/context';
import { SetupEngine } from '../setups/engine';
import { HigherTrendTracker } from '../setups/higher';
import { DEFAULT_SETUP_PARAMS, type SetupParams } from '../setups/params';

/** Posição do fechamento na Bollinger (20, 2). */
export type BbZone = 'acima' | 'superior' | 'inferior' | 'abaixo' | 'indefinida';
/** Setup armado ou acionado neste candle (SPEC §8). */
export type SetupSignal = 'compra' | 'venda' | 'nenhum';

/**
 * "Situação" de um candle FECHADO (SPEC §23.2, camada 1): setup, tendência nas 3 escalas, ADX e posição
 * na Bollinger. Tudo calculado só com candles até ele (pivôs só depois de confirmados; escalas maiores
 * só com períodos já fechados).
 */
export interface Situation {
  setup: SetupSignal;
  /** Escala do gráfico, a maior e a maior ainda (ex.: 15 min, 60 min, diário). */
  trend: TrendLabel;
  trend2: TrendLabel;
  trend3: TrendLabel;
  adx: AdxClass | 'indefinido';
  bb: BbZone;
}

/** Níveis do mais específico ao mais geral (o encolhimento puxa cada um para o seguinte). */
export const SITUATION_LEVELS = ['completa', 'tendencias', 'tendencia', 'qualquer'] as const;
export type LevelId = (typeof SITUATION_LEVELS)[number];
/** Recortes de uma dimensão só, mostrados ao lado (não entram na estimativa). */
export const SITUATION_FACETS = ['setup', 'adx', 'bb'] as const;
export type FacetId = (typeof SITUATION_FACETS)[number];

export const LEVEL_LABEL: Readonly<Record<LevelId | FacetId, string>> = {
  completa: 'Situação completa (setup + 3 escalas + ADX + Bollinger)',
  tendencias: 'Mesma tendência nas 3 escalas',
  tendencia: 'Mesma tendência nesta escala',
  qualquer: 'Qualquer candle (régua "sempre sobe")',
  setup: 'Mesmo sinal de setup',
  adx: 'Mesma faixa de ADX',
  bb: 'Mesma posição na Bollinger',
};

export function situationKey(s: Situation, id: LevelId | FacetId): string {
  switch (id) {
    case 'completa':
      return `${s.setup}|${s.trend}|${s.trend2}|${s.trend3}|${s.adx}|${s.bb}`;
    case 'tendencias':
      return `${s.trend}|${s.trend2}|${s.trend3}`;
    case 'tendencia':
      return s.trend;
    case 'qualquer':
      return '*';
    case 'setup':
      return s.setup;
    case 'adx':
      return s.adx;
    case 'bb':
      return s.bb;
  }
}

const BB_LABEL: Record<BbZone, string> = {
  acima: 'acima da banda de cima',
  superior: 'na metade de cima',
  inferior: 'na metade de baixo',
  abaixo: 'abaixo da banda de baixo',
  indefinida: 'sem Bollinger ainda',
};
const ADX_SHORT: Record<AdxClass | 'indefinido', string> = {
  lateral: 'ADX < 20',
  cinzenta: 'ADX 20–25',
  tendencia: 'ADX 25–40',
  'muito-forte': 'ADX > 40',
  indefinido: 'sem ADX ainda',
};
const SETUP_SHORT: Record<SetupSignal, string> = {
  compra: 'setup de compra',
  venda: 'setup de venda',
  nenhum: 'sem setup',
};

/** Escalas usadas na situação: a do gráfico e até duas maiores (null quando não existem). */
export function situationTimeframes(
  tf: Timeframe,
): [Timeframe, Timeframe | null, Timeframe | null] {
  const t2 = higherTimeframe(tf);
  return [tf, t2, t2 ? higherTimeframe(t2) : null];
}

/** Descrição em PT-BR de cada parte da situação (para a tela). */
export function describeSituation(s: Situation, tf: Timeframe): string[] {
  const [t1, t2, t3] = situationTimeframes(tf);
  const tr = (l: TrendLabel, t: Timeframe | null) =>
    t ? `${TIMEFRAME_LABEL[t]}: ${l === 'indefinida' ? 'sem dados' : l}` : null;
  return [
    SETUP_SHORT[s.setup],
    [tr(s.trend, t1), tr(s.trend2, t2), tr(s.trend3, t3)].filter(Boolean).join(' · '),
    ADX_SHORT[s.adx],
    `Bollinger: ${BB_LABEL[s.bb]}`,
  ];
}

export function bbZone(close: number, upper: number, middle: number, lower: number): BbZone {
  if (![close, upper, middle, lower].every(Number.isFinite)) return 'indefinida';
  if (close > upper) return 'acima';
  if (close < lower) return 'abaixo';
  return close >= middle ? 'superior' : 'inferior';
}

export interface SituationOptions {
  tf: Timeframe;
  tz: string;
  tick?: number;
  setupParams?: SetupParams;
}

/**
 * Calcula a situação candle a candle (incremental, o mesmo no navegador, no servidor e no laboratório).
 * Reaproveita o motor de setups (que já acompanha a escala maior) e acrescenta a terceira escala.
 */
export class SituationTracker {
  readonly engine: SetupEngine;
  readonly timeframes: [Timeframe, Timeframe | null, Timeframe | null];
  private readonly third: HigherTrendTracker | null;
  private readonly bb = new BollingerStream(20, 2);
  private readonly params: SetupParams;

  constructor(opts: SituationOptions) {
    this.params = opts.setupParams ?? DEFAULT_SETUP_PARAMS;
    this.engine = new SetupEngine({
      params: this.params,
      tf: opts.tf,
      tz: opts.tz,
      ...(opts.tick !== undefined ? { tick: opts.tick } : {}),
    });
    this.timeframes = situationTimeframes(opts.tf);
    const t3 = this.timeframes[2];
    this.third = t3 ? new HigherTrendTracker(opts.tf, t3, opts.tz, this.params.pa) : null;
  }

  /** Recebe um candle FECHADO e devolve a situação nele. */
  push(c: Candle): Situation {
    const events = this.engine.push(c);
    this.engine.events.length = 0;
    const s = this.engine.series;
    const t = s.length - 1;
    const sides = new Set(
      events.filter((e) => e.state === 'armado' || e.state === 'acionado').map((e) => e.side),
    );
    const setup: SetupSignal = sides.size !== 1 ? 'nenhum' : sides.has('buy') ? 'compra' : 'venda';
    const trend = classifyTrend(s, this.engine.pivots, t, this.params.pa).value;
    const trend2 = this.engine.higherNow()?.trend ?? 'indefinida';
    const trend3 = this.third?.push(c)?.trend ?? 'indefinida';
    const b = this.bb.next(c.close);
    return {
      setup,
      trend,
      trend2,
      trend3,
      adx: adxClass(s.v(s.adx, t)) ?? 'indefinido',
      bb: bbZone(c.close, b.upper, b.middle, b.lower),
    };
  }
}
