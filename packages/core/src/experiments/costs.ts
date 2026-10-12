import type { Candle } from '@radar/shared';
import type { CostModel } from '../paper/engine';
import { AtrStream } from '../indicators/volatility';

/**
 * E6 (SPEC §12.4): "40% de acerto com 1:2 dá lucro" — a conta do vídeo é 0,4 × 2 − 0,6 × 1 = +0,2 R
 * por trade, ANTES de custos e IR. Aqui o custo de ida e volta vira fração do risco (R), usando a
 * distância típica do stop no ativo e na escala (stop = `stopAtr` × ATR14, decisão nossa), e o IR é
 * aplicado sobre o que sobra (aproximação: 15% swing, 20% day trade, sem isenção nem compensação).
 */
export interface CostDragInput {
  winRate?: number;
  payoff?: number;
  /** Stop típico em múltiplos do ATR14 (padrão 1). */
  stopAtr?: number;
  costs: CostModel;
  tick: number;
  /** Valor de cada trade para diluir a corretagem fixa (padrão R$ 10.000). */
  notional?: number;
  /** Alíquota de IR sobre o lucro (0 quando o mercado não é simulado). */
  taxRate: number;
}

export interface CostDragResult {
  /** Mediana do stop como fração do preço. */
  stopPct: number;
  /** Custo de ida e volta como fração do preço. */
  roundTripPct: number;
  /** Custo de ida e volta em R. */
  costR: number;
  grossR: number;
  netR: number;
  afterTaxR: number;
  /** Taxa de acerto mínima para empatar depois dos custos (com o mesmo payoff). */
  breakEvenWinRate: number;
  samples: number;
}

function median(xs: number[]): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function costDrag(candles: readonly Candle[], o: CostDragInput): CostDragResult {
  const win = o.winRate ?? 0.4;
  const payoff = o.payoff ?? 2;
  const k = o.stopAtr ?? 1;
  const notional = o.notional ?? 10_000;
  const atr = new AtrStream(14);
  const stopPcts: number[] = [];
  const roundTrips: number[] = [];
  for (const c of candles) {
    const a = atr.next(c);
    if (!Number.isFinite(a) || c.close <= 0) continue;
    stopPcts.push((k * a) / c.close);
    // por lado: taxa % + meio spread + derrapagem em ticks; corretagem fixa diluída no valor do trade
    const side =
      o.costs.feePct + o.costs.spreadPct / 2 + (o.costs.slippageTicks * o.tick) / c.close;
    roundTrips.push(2 * side + (2 * o.costs.commissionPerOrder) / notional);
  }
  const stopPct = median(stopPcts);
  const roundTripPct = median(roundTrips);
  const costR = roundTripPct / stopPct;
  const grossR = win * payoff - (1 - win);
  const netR = grossR - costR;
  const afterTaxR = netR > 0 ? netR * (1 - o.taxRate) : netR;
  return {
    stopPct,
    roundTripPct,
    costR,
    grossR,
    netR,
    afterTaxR,
    // p × payoff − (1 − p) − custo = 0
    breakEvenWinRate: (1 + costR) / (payoff + 1),
    samples: stopPcts.length,
  };
}
