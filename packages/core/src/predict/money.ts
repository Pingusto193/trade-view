import type { Candle, Market } from '@radar/shared';
import { drawdown, sampleLabel } from '../backtest/metrics';
import { DEFAULT_COSTS, fees as feeOf, type CostModel } from '../paper/engine';
import { roundTick } from '../setups/fills';
import { apurarB3, type TaxTrade } from '../tax/b3';
import { DEFAULT_PREDICT, type PredictParams } from './params';
import type { ScoredPrediction } from './score';

export interface MoneyMeta {
  tick: number;
  pointValue: number;
  minQty: number;
  qtyStep: number;
  market: Market;
}

export interface SignalTrade {
  side: 'buy' | 'sell';
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  qty: number;
  fees: number;
  /** Resultado líquido de custos (sem IR). */
  pnl: number;
}

export interface SignalBacktest {
  trades: SignalTrade[];
  /** Pontos em que a probabilidade não se afastou de 50% o bastante (ficou de fora). */
  skipped: number;
  from: number | null;
  to: number | null;
  winRate: number | null;
  /** Retorno do capital depois de custos (composto, trade a trade). */
  totalReturn: number;
  /** IR simulado (só B3) e retorno depois dele; null fora da B3 (regras diferentes, não simuladas). */
  tax: number | null;
  totalReturnAfterTax: number | null;
  /** Comprar no início e segurar até o fim, com custos de ida e volta. */
  buyHold: number | null;
  maxDrawdown: number;
  /** Fração dos candles do período com posição aberta. */
  exposure: number;
  sample: ReturnType<typeof sampleLabel>;
  /** Avisos da simulação (ex.: futuros com 1 contrato por operação). */
  notes: string[];
}

const SP_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
const spDate = (t: number) => SP_DATE.format(new Date(t));

function adverse(price: number, side: 'buy' | 'sell', tick: number, c: CostModel): number {
  const spread = (price * c.spreadPct) / 2;
  const slip = c.slippageTicks * tick;
  return roundTick(side === 'buy' ? price + spread + slip : price - spread - slip, tick);
}

/**
 * Resultado em dinheiro de operar o sinal (SPEC §23.2): em cada previsão fora da amostra com
 * probabilidade ≥ 50% + margem, compra na ABERTURA do candle seguinte (não dá para executar no
 * fechamento que gerou o sinal) e vende no fechamento do candle-alvo; com `allowShort`, vende quando a
 * probabilidade ≤ 50% − margem. Spread, derrapagem e taxas do Modo Treino; IR da B3 pela mesma apuração
 * do diário. Ações e cripto: o capital todo em cada operação (sem alavancagem). Futuros (valor do ponto
 * ≠ 1): 1 contrato por operação, e o retorno é sobre o capital informado.
 */
export function signalBacktest(
  candles: readonly Candle[],
  points: readonly ScoredPrediction[],
  horizon: number,
  meta: MoneyMeta,
  params: PredictParams = DEFAULT_PREDICT,
  costs: CostModel = DEFAULT_COSTS[meta.market],
): SignalBacktest {
  const index = new Map<number, number>();
  candles.forEach((c, i) => index.set(c.time, i));
  const pv = meta.pointValue;
  const future = pv !== 1;
  let equity = params.capital;
  const trades: SignalTrade[] = [];
  const curve: { time: number; equity: number }[] = [];
  let skipped = 0;
  let inMarket = 0;
  let first: number | null = null;
  let lastIdx: number | null = null;
  const notes: string[] = [];
  if (future) notes.push('Futuros: 1 contrato por operação; retorno sobre o capital informado.');
  if (!params.allowShort) notes.push('Só compras (vender exige aluguel de ações ou margem).');

  for (const pt of points) {
    const t = index.get(pt.time);
    if (t === undefined) continue;
    const e = t + 1;
    const x = t + horizon;
    const ce = candles[e];
    const cx = candles[x];
    if (!ce || !cx) continue;
    first ??= e;
    lastIdx = x;
    const side: 'buy' | 'sell' | null =
      pt.p >= 0.5 + params.margin
        ? 'buy'
        : params.allowShort && pt.p <= 0.5 - params.margin
          ? 'sell'
          : null;
    if (!side) {
      skipped++;
      continue;
    }
    const entry = adverse(ce.open, side, meta.tick, costs);
    const exit = adverse(cx.close, side === 'buy' ? 'sell' : 'buy', meta.tick, costs);
    let qty = meta.minQty;
    if (!future) {
      const steps = Math.floor(equity / (entry * pv) / meta.qtyStep);
      qty = steps * meta.qtyStep;
      if (qty < meta.minQty) {
        skipped++;
        continue;
      }
    }
    const fee = feeOf(entry, qty, pv, costs) + feeOf(exit, qty, pv, costs);
    const gross = (side === 'buy' ? exit - entry : entry - exit) * qty * pv;
    const pnl = gross - fee;
    equity += pnl;
    inMarket += x - e + 1;
    trades.push({
      side,
      entryTime: ce.time,
      exitTime: cx.time,
      entry,
      exit,
      qty,
      fees: fee,
      pnl,
    });
    curve.push({ time: cx.time, equity });
  }

  const n = trades.length;
  let tax: number | null = null;
  if (meta.market === 'b3' && n) {
    const taxTrades: TaxTrade[] = trades.map((t) => ({
      time: t.exitTime,
      modality: spDate(t.entryTime) === spDate(t.exitTime) ? 'day' : 'swing',
      assetClass: future ? 'outro' : 'acao',
      saleValue: (t.side === 'buy' ? t.exit : t.entry) * t.qty * pv,
      result: t.pnl,
    }));
    const months = apurarB3(taxTrades);
    tax = months.reduce((s, m) => s + m.darf, 0) + (months.at(-1)?.pendingBelowMin ?? 0);
  } else if (meta.market === 'b3') tax = 0;
  else notes.push('IR fora da B3 não é simulado (regras de cripto e exterior são outras).');

  const buyHold =
    first !== null && lastIdx !== null
      ? (() => {
          const a = adverse((candles[first] as Candle).open, 'buy', meta.tick, costs);
          const b = adverse((candles[lastIdx] as Candle).close, 'sell', meta.tick, costs);
          return (b * (1 - costs.feePct)) / (a * (1 + costs.feePct)) - 1;
        })()
      : null;
  const span = first !== null && lastIdx !== null ? lastIdx - first + 1 : 0;
  return {
    trades,
    skipped,
    from: first !== null ? (candles[first] as Candle).time : null,
    to: lastIdx !== null ? (candles[lastIdx] as Candle).time : null,
    winRate: n ? trades.filter((t) => t.pnl > 0).length / n : null,
    totalReturn: equity / params.capital - 1,
    tax,
    totalReturnAfterTax: tax === null ? null : (equity - tax) / params.capital - 1,
    buyHold,
    maxDrawdown: drawdown([{ time: 0, equity: params.capital }, ...curve]).max,
    exposure: span ? inMarket / span : 0,
    sample: sampleLabel(n),
    notes,
  };
}
