import type { Candle } from '@radar/shared';
import { stopMovedBack } from '../journal/real';
import { exitHit, orderFill, type CostModel, type Interval, type OrderType } from './engine';
import type { FeedbackExitKind } from './feedback';

/**
 * Livro do REPLAY (SPEC §13): o usuário avança candle a candle num trecho do passado e opera com
 * dinheiro fictício. As execuções usam as MESMAS regras do treino ao vivo (`orderFill`/`exitHit`):
 * cada candle revelado é um intervalo de preço. Diferenças honestas em relação ao ao vivo:
 * - A decisão é tomada com o candle FECHADO: ordem a mercado executa na abertura do candle seguinte
 *   (com meio spread + derrapagem), nunca no fechamento que você acabou de ver.
 * - Dentro de um candle não se sabe a ordem dos preços: stop e alvo no mesmo candle = stop primeiro;
 *   no candle da entrada, só o stop vale (igual ao treino ao vivo).
 * - Uma posição por vez, só compra (como no treino ao vivo nesta versão).
 * Valores em dinheiro: em R$, convertidos por um câmbio FIXO da sessão (1 para ativos em reais).
 */
export interface ReplayPlan {
  setup: string;
  tfSetup: string;
  aligned: boolean;
  warnings: string[];
  released: boolean;
  missing: string[];
}

export interface ReplayOrder {
  id: string;
  side: 'buy' | 'sell';
  type: OrderType;
  qty: number;
  /** Limite ou gatilho (null a mercado). */
  price: number | null;
  stop: number | null;
  target: number | null;
  /** Candle (abertura, UTC ms) em que a ordem foi dada: só vale do candle seguinte em diante. */
  placedAt: number;
  plan: ReplayPlan | null;
}

export interface ReplayPosition {
  id: string;
  qty: number;
  maxQty: number;
  avgPrice: number;
  stop: number | null;
  target: number | null;
  initialStop: number | null;
  openedAt: number;
  /** Derrapagem + meio spread pagos na entrada, por unidade (o feedback compara com o gatilho). */
  entryCostPerUnit: number;
  /** Quanto saiu do caixa na entrada (R$, com taxas). */
  costBrl: number;
  /** Quanto voltou ao caixa nas saídas (R$, já sem taxas). */
  proceedsBrl: number;
  feesBrl: number;
  exitValue: number;
  exitQty: number;
  riskPct: number | null;
  stopMovedBack: boolean;
  plan: ReplayPlan | null;
}

export interface ReplayTrade extends ReplayPosition {
  closedAt: number;
  exitPrice: number;
  exitKind: FeedbackExitKind;
  realizedBrl: number;
  r: number | null;
}

export interface ReplayEvent {
  time: number;
  kind:
    | 'entrada'
    | 'saida'
    | 'stop'
    | 'alvo'
    | 'recusada'
    | 'stop-movido'
    | 'stop-movido-para-tras'
    | 'alvo-movido'
    | 'cancelada';
  detail: string;
}

export interface ReplayBook {
  initialBalance: number;
  cash: number;
  /** Câmbio fixo da sessão: R$ por unidade da moeda do ativo. */
  fx: number;
  tick: number;
  pointValue: number;
  costs: CostModel;
  orders: ReplayOrder[];
  position: ReplayPosition | null;
  trades: ReplayTrade[];
  events: ReplayEvent[];
}

export class ReplayError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export function newReplayBook(o: {
  initialBalance: number;
  fx: number;
  tick: number;
  pointValue: number;
  costs: CostModel;
}): ReplayBook {
  return { ...o, cash: o.initialBalance, orders: [], position: null, trades: [], events: [] };
}

/** Patrimônio no fechamento de um candle (caixa + posição a preço de fechamento, sem custos de saída). */
export function replayEquity(b: ReplayBook, lastClose: number | null): number {
  const p = b.position;
  if (!p || lastClose === null) return b.cash;
  return b.cash + p.qty * lastClose * b.pointValue * b.fx;
}

/** Dar uma ordem no candle `now` (o último revelado). Executa a partir do candle seguinte. */
export function replayOrder(b: ReplayBook, o: ReplayOrder, lastClose: number): ReplayBook {
  if (!(o.qty > 0)) throw new ReplayError('Quantidade inválida.');
  if (o.side === 'buy') {
    if (b.position) throw new ReplayError('Já há uma posição aberta: uma por vez no replay.');
    if (b.orders.some((x) => x.side === 'buy'))
      throw new ReplayError('Já há uma ordem de compra pendente: cancele antes de dar outra.');
    if (o.type !== 'market' && (o.price === null || !(o.price > 0)))
      throw new ReplayError('Informe o preço da ordem limitada ou stop.');
    if (o.type === 'limit' && o.price !== null && o.price >= lastClose)
      throw new ReplayError('Compra limitada fica ABAIXO do último preço.');
    if (o.type === 'stop' && o.price !== null && o.price <= lastClose)
      throw new ReplayError('Compra stop (rompimento) fica ACIMA do último preço.');
    const ref = o.type === 'market' ? lastClose : (o.price as number);
    if (o.stop !== null && o.stop >= ref) throw new ReplayError('O stop fica abaixo da entrada.');
    if (o.target !== null && o.target <= ref)
      throw new ReplayError('O alvo fica acima da entrada.');
  } else {
    if (!b.position) throw new ReplayError('Não há posição para vender.');
    if (o.type !== 'market') throw new ReplayError('No replay, a venda manual é a mercado.');
    if (o.qty > b.position.qty + 1e-9) throw new ReplayError('Venda maior que a posição.');
  }
  return { ...b, orders: [...b.orders, o] };
}

export function replayCancel(b: ReplayBook, orderId: string, time: number): ReplayBook {
  if (!b.orders.some((o) => o.id === orderId)) throw new ReplayError('Ordem não encontrada.', 404);
  return {
    ...b,
    orders: b.orders.filter((o) => o.id !== orderId),
    events: [...b.events, { time, kind: 'cancelada', detail: 'Ordem cancelada' }],
  };
}

/** Mover stop/alvo da posição. Afastar o stop exige `confirmMovedBack` (SPEC §11). */
export function replayMove(
  b: ReplayBook,
  u: { stop?: number | null; target?: number | null; confirmMovedBack?: boolean },
  time: number,
  lastClose: number,
): ReplayBook {
  const p = b.position;
  if (!p) throw new ReplayError('Não há posição aberta.');
  const events = [...b.events];
  let next = { ...p };
  if (u.stop !== undefined && u.stop !== p.stop) {
    if (u.stop !== null && u.stop >= lastClose)
      throw new ReplayError('O stop fica abaixo do último preço (senão sairia na hora).');
    const back = stopMovedBack('long', p.stop, u.stop);
    if (back && !u.confirmMovedBack)
      throw new ReplayError(
        'Afastar o stop aumenta o risco. Confirme para registrar "stop movido para trás".',
        409,
      );
    next = {
      ...next,
      stop: u.stop,
      stopMovedBack: p.stopMovedBack || back,
      initialStop: p.initialStop ?? u.stop,
    };
    events.push({
      time,
      kind: back ? 'stop-movido-para-tras' : 'stop-movido',
      detail: u.stop === null ? 'Stop retirado' : `Stop em ${u.stop}`,
    });
  }
  if (u.target !== undefined && u.target !== p.target) {
    if (u.target !== null && u.target <= lastClose)
      throw new ReplayError('O alvo fica acima do último preço.');
    next = { ...next, target: u.target };
    events.push({
      time,
      kind: 'alvo-movido',
      detail: u.target === null ? 'Alvo retirado' : `Alvo em ${u.target}`,
    });
  }
  return { ...b, position: next, events };
}

function close(
  b: ReplayBook,
  p: ReplayPosition,
  qty: number,
  price: number,
  feesAsset: number,
  time: number,
  kind: FeedbackExitKind,
): { book: ReplayBook; event: ReplayEvent } {
  const proceeds = (price * qty * b.pointValue - feesAsset) * b.fx;
  const pos: ReplayPosition = {
    ...p,
    qty: p.qty - qty < 1e-9 ? 0 : p.qty - qty,
    proceedsBrl: p.proceedsBrl + proceeds,
    feesBrl: p.feesBrl + feesAsset * b.fx,
    exitValue: p.exitValue + price * qty,
    exitQty: p.exitQty + qty,
  };
  const cash = b.cash + proceeds;
  const label = kind === 'stop' ? 'Stop executado' : kind === 'alvo' ? 'Alvo executado' : 'Venda';
  const event: ReplayEvent = {
    time,
    kind: kind === 'stop' ? 'stop' : kind === 'alvo' ? 'alvo' : 'saida',
    detail: `${label}: ${qty} a ${price}`,
  };
  if (pos.qty > 0) return { book: { ...b, cash, position: pos }, event };
  const realizedBrl = round(pos.proceedsBrl - pos.costBrl);
  const risk =
    pos.initialStop !== null
      ? (pos.avgPrice - pos.initialStop) * pos.maxQty * b.pointValue * b.fx
      : null;
  const trade: ReplayTrade = {
    ...pos,
    qty: pos.maxQty,
    closedAt: time,
    exitPrice: pos.exitValue / pos.exitQty,
    exitKind: kind,
    realizedBrl,
    r: risk !== null && risk > 0 ? round(realizedBrl / risk, 2) : null,
  };
  return {
    book: {
      ...b,
      cash,
      position: null,
      // stop/alvo encerraram: vendas manuais pendentes perdem o sentido
      orders: b.orders.filter((o) => o.side === 'buy'),
      trades: [...b.trades, trade],
    },
    event,
  };
}

/** Revela um candle: executa ordens pendentes, stop e alvo, nessa ordem, com as regras do treino. */
export function replayStep(b0: ReplayBook, c: Candle, newId: () => string): ReplayBook {
  const iv: Interval = {
    first: c.open,
    high: c.high,
    low: c.low,
    last: c.close,
    time: c.time,
    newBar: true,
  };
  let b = b0;
  const events: ReplayEvent[] = [];
  // 1. venda manual a mercado: na abertura (o primeiro preço do candle)
  for (const o of b.orders.filter((x) => x.side === 'sell' && x.placedAt < c.time)) {
    b = { ...b, orders: b.orders.filter((x) => x.id !== o.id) };
    const p = b.position;
    if (!p) continue;
    const f = orderFill({ ...o, side: 'sell' }, iv, b.tick, b.pointValue, b.costs);
    if (!f) continue;
    const r = close(b, p, Math.min(o.qty, p.qty), f.price, f.fees, c.time, 'manual');
    b = r.book;
    events.push(r.event);
  }
  // 2. stop/alvo da posição que já estava aberta
  if (b.position && b.position.openedAt < c.time) {
    const p = b.position;
    const hit = exitHit(p, iv, false, b.tick, b.pointValue, b.costs);
    if (hit) {
      const r = close(b, p, p.qty, hit.price, hit.fees, c.time, hit.kind);
      b = r.book;
      events.push(r.event);
    }
  }
  // 3. entrada pendente
  for (const o of b.orders.filter((x) => x.side === 'buy' && x.placedAt < c.time)) {
    const f = orderFill(o, iv, b.tick, b.pointValue, b.costs);
    if (!f) continue;
    b = { ...b, orders: b.orders.filter((x) => x.id !== o.id) };
    const cost = (f.price * o.qty * b.pointValue + f.fees) * b.fx;
    if (cost > b.cash + 1e-6) {
      events.push({
        time: c.time,
        kind: 'recusada',
        detail: 'Saldo insuficiente na execução (gap ou custos).',
      });
      continue;
    }
    const equity = b.cash;
    const risk = o.stop !== null ? (f.price - o.stop) * o.qty * b.pointValue * b.fx : null;
    const position: ReplayPosition = {
      id: newId(),
      qty: o.qty,
      maxQty: o.qty,
      avgPrice: f.price,
      stop: o.stop,
      target: o.target,
      initialStop: o.stop,
      openedAt: c.time,
      entryCostPerUnit: f.slippage,
      costBrl: cost,
      proceedsBrl: 0,
      feesBrl: f.fees * b.fx,
      exitValue: 0,
      exitQty: 0,
      riskPct: risk !== null && equity > 0 ? round((risk / equity) * 100, 2) : null,
      stopMovedBack: false,
      plan: o.plan,
    };
    b = { ...b, cash: b.cash - cost, position };
    events.push({
      time: c.time,
      kind: 'entrada',
      detail: `Compra executada: ${o.qty} a ${f.price}${f.gap ? ' (gap)' : ''}`,
    });
    // no candle da entrada, só o stop vale (não dá para saber se o alvo veio antes da entrada)
    const hit = exitHit(position, iv, true, b.tick, b.pointValue, b.costs);
    if (hit) {
      const r = close(b, position, position.qty, hit.price, hit.fees, c.time, hit.kind);
      b = r.book;
      events.push(r.event);
    }
  }
  return events.length ? { ...b, events: [...b.events, ...events] } : b;
}
