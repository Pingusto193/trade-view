import { formatDate } from '@radar/shared';
import type { TaxAssetClass, TaxTrade } from '../tax/b3';

/**
 * Trade real (SPEC §13: "no modo Real, os trades são registrados no diário a partir do que o usuário
 * executou na corretora"). O Radar não envia ordens: as execuções são digitadas pelo usuário.
 *
 * Custo médio: entradas somam ao preço médio (em R$, já convertido pelo câmbio de cada execução);
 * cada saída realiza (preço de saída − preço médio) × quantidade, menos a taxa da saída e a parte
 * proporcional das taxas de entrada.
 */
export interface RealFill {
  time: number;
  kind: 'entrada' | 'saida';
  qty: number;
  /** Preço na moeda do ativo. */
  price: number;
  /** Custos da execução em R$ (corretagem, emolumentos, spread que você souber). */
  feesBrl: number;
  /** Câmbio R$ por unidade da moeda do ativo (1 para ativos em reais). */
  fx: number;
}

export interface RealTradeInput {
  side: 'long' | 'short';
  /** Valor de 1 ponto de preço por unidade/contrato (ações: 1; WIN: 0,20; WDO: 10; forex: unidades por lote). */
  pointValue: number;
  initialStop: number | null;
  fills: readonly RealFill[];
}

export interface RealExit {
  time: number;
  qty: number;
  price: number;
  /** Resultado líquido desta saída em R$ (já sem a taxa dela e a parte das taxas de entrada). */
  resultBrl: number;
  /** Valor da VENDA em R$ (base da isenção do IR das ações; na venda a descoberto, a venda é a entrada). */
  saleBrl: number;
  /** A saída foi no mesmo dia (em São Paulo) de uma entrada? */
  sameDay: boolean;
}

export interface RealTradeCalc {
  status: 'aberto' | 'fechado';
  /** Preço médio de entrada na moeda do ativo (null = ainda sem entrada). */
  avgEntry: number | null;
  /** Câmbio médio das entradas. */
  avgFx: number;
  openQty: number;
  /** Maior quantidade aberta ao mesmo tempo (base do R). */
  maxQty: number;
  avgExit: number | null;
  realizedBrl: number;
  feesBrl: number;
  /** Risco inicial em R$: |entrada − stop inicial| × maior quantidade × valor do ponto × câmbio. */
  initialRiskBrl: number | null;
  /** Resultado em R (só com o trade fechado e stop inicial). */
  r: number | null;
  openedAt: number | null;
  closedAt: number | null;
  exits: RealExit[];
}

export class RealTradeError extends Error {}

const EPS = 1e-9;
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export function realTrade(t: RealTradeInput): RealTradeCalc {
  const dir = t.side === 'long' ? 1 : -1;
  const fills = [...t.fills].sort((a, b) => a.time - b.time || (a.kind === 'entrada' ? -1 : 1));
  let qty = 0;
  let maxQty = 0;
  let avg = 0; // preço médio na moeda do ativo
  let avgBrl = 0; // preço médio em R$ (com o câmbio de cada entrada)
  let feesPerUnit = 0; // taxas de entrada ainda não realizadas, por unidade
  let realized = 0;
  let fees = 0;
  let exitValue = 0;
  let exitQty = 0;
  let firstAvg: number | null = null;
  let firstFx = 1;
  const entryDays = new Set<string>();
  const exits: RealExit[] = [];
  for (const f of fills) {
    if (!(f.qty > 0) || !(f.price > 0) || !(f.fx > 0) || f.feesBrl < 0)
      throw new RealTradeError('Execução com quantidade, preço, câmbio ou custo inválido.');
    fees += f.feesBrl;
    if (f.kind === 'entrada') {
      const q = qty + f.qty;
      avg = (avg * qty + f.price * f.qty) / q;
      avgBrl = (avgBrl * qty + f.price * f.fx * f.qty) / q;
      feesPerUnit = (feesPerUnit * qty + f.feesBrl) / q;
      qty = q;
      maxQty = Math.max(maxQty, qty);
      entryDays.add(formatDate(f.time));
      // o R mede o risco da PRIMEIRA montagem da posição (antes de qualquer saída)
      if (exitQty === 0) {
        firstAvg = avg;
        firstFx = avgBrl / avg;
      }
      continue;
    }
    if (f.qty > qty + EPS)
      throw new RealTradeError('A saída é maior que a quantidade aberta naquele momento.');
    const gross = dir * (f.price * f.fx - avgBrl) * f.qty * t.pointValue;
    const result = gross - f.feesBrl - feesPerUnit * f.qty;
    realized += result;
    exitValue += f.price * f.qty;
    exitQty += f.qty;
    exits.push({
      time: f.time,
      qty: f.qty,
      price: f.price,
      resultBrl: round(result),
      saleBrl: round((dir === 1 ? f.price * f.fx : avgBrl) * f.qty * t.pointValue),
      sameDay: entryDays.has(formatDate(f.time)),
    });
    qty -= f.qty;
    if (qty < EPS) {
      qty = 0;
      avg = 0;
      avgBrl = 0;
      feesPerUnit = 0;
    }
  }
  const closed = fills.length > 0 && qty === 0 && exitQty > 0;
  const initialRiskBrl =
    t.initialStop !== null && firstAvg !== null
      ? Math.abs(firstAvg - t.initialStop) * maxQty * t.pointValue * firstFx
      : null;
  return {
    status: closed ? 'fechado' : 'aberto',
    avgEntry: firstAvg === null ? null : qty > 0 ? avg : firstAvg,
    avgFx: firstFx,
    openQty: qty,
    maxQty,
    avgExit: exitQty > 0 ? exitValue / exitQty : null,
    realizedBrl: round(realized),
    feesBrl: round(fees),
    initialRiskBrl: initialRiskBrl === null ? null : round(initialRiskBrl),
    r:
      closed && initialRiskBrl !== null && initialRiskBrl > 0
        ? round(realized / initialRiskBrl, 2)
        : null,
    openedAt: fills.find((f) => f.kind === 'entrada')?.time ?? null,
    closedAt: closed ? (fills.at(-1)?.time ?? null) : null,
    exits,
  };
}

/** O stop novo está mais longe da entrada que o atual (aumenta o risco)? */
export function stopMovedBack(
  side: 'long' | 'short',
  current: number | null,
  next: number | null,
): boolean {
  if (current === null) return false;
  if (next === null) return true; // tirar o stop é o pior "para trás"
  return side === 'long' ? next < current : next > current;
}

/** Operações para a apuração do IR da B3 (custos já descontados). Day trade = saída no dia de uma entrada. */
export function realTaxTrades(calc: RealTradeCalc, assetClass: TaxAssetClass): TaxTrade[] {
  return calc.exits.map((e) => ({
    time: e.time,
    modality: e.sameDay ? 'day' : 'swing',
    assetClass,
    saleValue: e.saleBrl,
    result: e.resultBrl,
  }));
}
