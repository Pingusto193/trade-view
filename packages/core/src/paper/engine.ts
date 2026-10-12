import type { Candle, Market } from '@radar/shared';
import { z } from 'zod';
import { roundTick } from '../setups/fills';

/**
 * Execução de ordens do Modo Treino (SPEC §13) com preços REAIS chegando da fonte. Lógica pura: o
 * servidor alimenta as atualizações do candle de 1 minuto e grava o que este módulo decide.
 *
 * Regra de ouro: o treino nunca pode parecer melhor do que o real.
 * - Só vale o preço negociado DEPOIS da ordem: entre duas atualizações, o intervalo de preço é
 *   reconstruído (máxima/mínima novas do candle) — nada do que aconteceu antes da ordem conta.
 * - Gap contra (abertura além do stop): executa na abertura. Alvo com gap a favor: executa no alvo.
 * - Stop e alvo no mesmo intervalo: stop primeiro. No intervalo da entrada, só o stop.
 * - Ordem a mercado e stop pagam meio spread + derrapagem (slippage) em ticks; limitada não derrapa
 *   e só executa se o preço passar ALÉM do limite (tocar não basta).
 * - Taxas (corretagem e emolumentos) em toda execução.
 */

export const costModelSchema = z.object({
  /** Corretagem fixa por ordem executada, na moeda do ativo. */
  commissionPerOrder: z.number().min(0).default(0),
  /** Taxas proporcionais ao valor (emolumentos, taxa da exchange), por lado. 0,0003 = 0,03%. */
  feePct: z.number().min(0).max(0.05).default(0),
  /** Derrapagem em ticks contra você em ordens a mercado e stop. */
  slippageTicks: z.number().int().min(0).max(100).default(1),
  /** Spread total estimado (fração do preço); metade é paga em cada execução a mercado/stop. */
  spreadPct: z.number().min(0).max(0.05).default(0),
});
export type CostModel = z.infer<typeof costModelSchema>;

/**
 * Custos padrão por mercado (DATA_SOURCES §14, selo 🟡: confira com a sua corretora e edite na conta).
 */
export const DEFAULT_COSTS: Readonly<Record<Market, CostModel>> = {
  b3: { commissionPerOrder: 0, feePct: 0.0003, slippageTicks: 1, spreadPct: 0 },
  crypto: { commissionPerOrder: 0, feePct: 0.001, slippageTicks: 0, spreadPct: 0.0002 },
  us: { commissionPerOrder: 0, feePct: 0, slippageTicks: 1, spreadPct: 0 },
  forex: { commissionPerOrder: 0, feePct: 0, slippageTicks: 2, spreadPct: 0.0002 },
};

export type OrderType = 'market' | 'limit' | 'stop';
export type OrderSide = 'buy' | 'sell';

export interface PaperOrder {
  id: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  /** Preço limite ou gatilho do stop (null a mercado). */
  price: number | null;
}

export interface PaperPosition {
  /** Só compra nesta versão (venda a descoberto exige aluguel/margem, ainda não simulados). */
  qty: number;
  avgPrice: number;
  stop: number | null;
  target: number | null;
}

/** Faixa de preço negociada entre duas atualizações da fonte. */
export interface Interval {
  /** Primeiro preço negociado no intervalo (abertura do candle novo ou o último preço conhecido). */
  first: number;
  high: number;
  low: number;
  last: number;
  /** Início do candle de 1 minuto (UTC ms). */
  time: number;
  /** Este intervalo começou um candle novo (pode haver gap na abertura). */
  newBar: boolean;
}

/**
 * Transforma a sequência de atualizações de um candle de 1 minuto em intervalos "só o que aconteceu
 * desde a última atualização".
 */
export class PriceTracker {
  private bar: Candle | null = null;
  private lastPrice: number | null = null;

  get last(): number | null {
    return this.lastPrice;
  }

  /** Estado inicial (ex.: último candle do histórico) — não gera intervalo. */
  seed(c: Candle): void {
    this.bar = { ...c };
    this.lastPrice = c.close;
  }

  update(c: Candle): Interval | null {
    const prev = this.bar;
    const last = this.lastPrice;
    if (prev && c.time < prev.time) return null; // atualização velha
    let iv: Interval;
    if (!prev || c.time > prev.time || last === null) {
      // candle novo: tudo dele aconteceu depois da última atualização
      iv = { first: c.open, high: c.high, low: c.low, last: c.close, time: c.time, newBar: true };
    } else {
      const high = c.high > prev.high ? c.high : Math.max(last, c.close);
      const low = c.low < prev.low ? c.low : Math.min(last, c.close);
      if (high === last && low === last && c.close === last) {
        this.bar = { ...c };
        return null; // nada negociou de novo
      }
      iv = {
        first: last,
        high: Math.max(high, last),
        low: Math.min(low, last),
        last: c.close,
        time: c.time,
        newBar: false,
      };
    }
    this.bar = { ...c };
    this.lastPrice = c.close;
    return iv;
  }
}

export interface Fill {
  price: number;
  /** Taxas na moeda do ativo. */
  fees: number;
  /** Diferença (contra você) entre o preço "da tela" e o executado, por unidade. */
  slippage: number;
  gap: boolean;
}

function adverse(price: number, side: OrderSide, tick: number, costs: CostModel): number {
  const spread = (price * costs.spreadPct) / 2;
  const slip = costs.slippageTicks * tick;
  const p = side === 'buy' ? price + spread + slip : price - spread - slip;
  return roundTick(p, tick);
}

export function fees(price: number, qty: number, pointValue: number, costs: CostModel): number {
  return price * qty * pointValue * costs.feePct + costs.commissionPerOrder;
}

/** Execução imediata a mercado no último preço conhecido. */
export function marketFill(
  side: OrderSide,
  lastPrice: number,
  qty: number,
  tick: number,
  pointValue: number,
  costs: CostModel,
): Fill {
  const price = adverse(lastPrice, side, tick, costs);
  return {
    price,
    fees: fees(price, qty, pointValue, costs),
    slippage: Math.abs(price - lastPrice),
    gap: false,
  };
}

/** A ordem pendente executa neste intervalo? */
export function orderFill(
  o: PaperOrder,
  iv: Interval,
  tick: number,
  pointValue: number,
  costs: CostModel,
): Fill | null {
  let raw: number | null = null;
  let gap = false;
  let slipped = true;
  if (o.type === 'market') {
    raw = iv.first;
    gap = iv.newBar;
  } else if (o.type === 'stop') {
    const lvl = o.price as number;
    if (o.side === 'buy') {
      if (iv.first >= lvl) {
        raw = iv.first;
        gap = iv.first > lvl;
      } else if (iv.high >= lvl) raw = lvl;
    } else if (iv.first <= lvl) {
      raw = iv.first;
      gap = iv.first < lvl;
    } else if (iv.low <= lvl) raw = lvl;
  } else {
    const lvl = o.price as number;
    slipped = false;
    if (o.side === 'buy') {
      if (iv.first < lvl)
        raw = iv.first; // abriu abaixo do limite: preço melhor
      else if (iv.low < lvl) raw = lvl; // precisou passar além do limite
    } else if (iv.first > lvl) raw = iv.first;
    else if (iv.high > lvl) raw = lvl;
  }
  if (raw === null) return null;
  const price = slipped ? adverse(raw, o.side, tick, costs) : roundTick(raw, tick);
  return {
    price,
    fees: fees(price, o.qty, pointValue, costs),
    slippage: Math.abs(price - raw),
    gap,
  };
}

export interface ExitHit extends Fill {
  kind: 'stop' | 'alvo';
}

/**
 * Stop/alvo de uma posição comprada neste intervalo. `entryInterval` = a entrada aconteceu neste
 * mesmo intervalo (só o stop vale).
 */
export function exitHit(
  p: PaperPosition,
  iv: Interval,
  entryInterval: boolean,
  tick: number,
  pointValue: number,
  costs: CostModel,
): ExitHit | null {
  const mk = (raw: number, kind: 'stop' | 'alvo', gap: boolean): ExitHit => {
    // stop é ordem stop (derrapa); alvo é ordem limitada (não derrapa)
    const price = kind === 'stop' ? adverse(raw, 'sell', tick, costs) : roundTick(raw, tick);
    return {
      kind,
      price,
      gap,
      fees: fees(price, p.qty, pointValue, costs),
      slippage: Math.abs(price - raw),
    };
  };
  if (p.stop !== null) {
    if (!entryInterval && iv.first <= p.stop) return mk(iv.first, 'stop', iv.first < p.stop);
    if (iv.low <= p.stop) return mk(p.stop, 'stop', false);
  }
  if (!entryInterval && p.target !== null) {
    if (iv.first > p.target) return mk(p.target, 'alvo', true);
    if (iv.high > p.target) return mk(p.target, 'alvo', false);
  }
  return null;
}

/** Resultado de fechar `qty` de uma posição comprada (na moeda do ativo, já sem taxas). */
export function realized(
  avgPrice: number,
  exitPrice: number,
  qty: number,
  pointValue: number,
  exitFees: number,
): number {
  return (exitPrice - avgPrice) * qty * pointValue - exitFees;
}
