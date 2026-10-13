import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  ReplayError,
  newReplayBook,
  replayEquity,
  replayMove,
  replayOrder,
  replayStep,
  type ReplayBook,
  type ReplayOrder,
} from '../src/paper/replay';

const D = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);
const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({
  time: T0 + i * D,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1000,
});
let n = 0;
const id = () => `id${++n}`;
// sem custos para as contas ficarem redondas (o motor de custos é o do treino, testado lá)
const ZERO = { commissionPerOrder: 0, feePct: 0, slippageTicks: 0, spreadPct: 0 };
const book = (over: Partial<ReplayBook> = {}) =>
  ({
    ...newReplayBook({ initialBalance: 10_000, fx: 1, tick: 0.01, pointValue: 1, costs: ZERO }),
    ...over,
  }) as ReplayBook;
const buy = (over: Partial<ReplayOrder> = {}): ReplayOrder => ({
  id: id(),
  side: 'buy',
  type: 'market',
  qty: 100,
  price: null,
  stop: 95,
  target: 110,
  placedAt: T0,
  plan: null,
  ...over,
});

describe('replay: execução candle a candle', () => {
  it('compra a mercado executa na ABERTURA do candle seguinte; alvo depois; R e caixa', () => {
    let b = replayOrder(book({ initialBalance: 20_000, cash: 20_000 }), buy(), 100);
    b = replayStep(b, bar(1, 101, 103, 99, 102), id);
    expect(b.position).toMatchObject({ avgPrice: 101, qty: 100, stop: 95, riskPct: 3 });
    expect(b.cash).toBe(20_000 - 10_100);
    expect(replayEquity(b, 102)).toBe(20_100);
    b = replayStep(b, bar(2, 104, 112, 103, 111), id);
    expect(b.position).toBeNull();
    expect(b.trades[0]).toMatchObject({
      exitKind: 'alvo',
      exitPrice: 110,
      realizedBrl: 900,
      r: 1.5,
    });
    expect(b.cash).toBe(20_900);
  });

  it('stop e alvo no mesmo candle: stop primeiro; gap abaixo do stop executa na abertura', () => {
    let b = replayOrder(book(), buy(), 100);
    b = replayStep(b, bar(1, 100, 101, 99, 100), id);
    b = replayStep(b, bar(2, 100, 115, 90, 105), id);
    expect(b.trades[0]).toMatchObject({ exitKind: 'stop', exitPrice: 95, r: -1 });

    let g = replayOrder(book(), buy(), 100);
    g = replayStep(g, bar(1, 100, 101, 99, 100), id);
    g = replayStep(g, bar(2, 90, 92, 88, 91), id);
    expect(g.trades[0]).toMatchObject({ exitKind: 'stop', exitPrice: 90 });
    expect(g.trades[0]?.r).toBe(-2); // o gap custa mais que 1R
  });

  it('no candle da entrada só o stop vale (o alvo não conta)', () => {
    let b = replayOrder(book(), buy(), 100);
    b = replayStep(b, bar(1, 100, 120, 99, 118), id);
    expect(b.position).not.toBeNull();
    let s = replayOrder(book(), buy(), 100);
    s = replayStep(s, bar(1, 100, 101, 94, 96), id);
    expect(s.trades[0]?.exitKind).toBe('stop');
  });

  it('limitada só executa se o preço passar ALÉM do limite; stop de entrada no rompimento', () => {
    let b = replayOrder(book(), buy({ type: 'limit', price: 98, stop: 94 }), 100);
    b = replayStep(b, bar(1, 100, 101, 98, 99), id); // tocou 98: não basta
    expect(b.position).toBeNull();
    b = replayStep(b, bar(2, 99, 100, 97, 99), id);
    expect(b.position?.avgPrice).toBe(98);

    let s = replayOrder(book(), buy({ type: 'stop', price: 102, stop: 97, qty: 50 }), 100);
    s = replayStep(s, bar(1, 101, 103, 100, 102), id);
    expect(s.position?.avgPrice).toBe(102);
  });

  it('ordem do mesmo candle em que foi dada não executa nele', () => {
    let b = replayOrder(book(), buy({ placedAt: T0 + D }), 100);
    b = replayStep(b, bar(1, 100, 101, 99, 100), id);
    expect(b.position).toBeNull();
    b = replayStep(b, bar(2, 100, 101, 99, 100), id);
    expect(b.position).not.toBeNull();
  });

  it('saldo insuficiente na execução é recusado (gap para cima)', () => {
    let b = replayOrder(book(), buy({ qty: 99, stop: null, target: null }), 100);
    b = replayStep(b, bar(1, 120, 121, 119, 120), id);
    expect(b.position).toBeNull();
    expect(b.events.at(-1)?.kind).toBe('recusada');
  });

  it('venda parcial a mercado na abertura e o resto no stop; R com custo médio', () => {
    let b = replayOrder(book(), buy(), 100);
    b = replayStep(b, bar(1, 100, 101, 99, 100), id);
    b = replayOrder(b, { ...buy(), side: 'sell', qty: 50, placedAt: T0 + D }, 100);
    b = replayStep(b, bar(2, 104, 105, 103, 104), id);
    expect(b.position?.qty).toBe(50);
    b = replayStep(b, bar(3, 100, 100, 94, 95), id);
    // +4 × 50 − 5 × 50 = −50 → risco 500 → −0,1R
    expect(b.trades[0]).toMatchObject({ realizedBrl: -50, r: -0.1, qty: 100 });
  });

  it('regras: uma posição por vez, stop do lado certo, stop para trás exige confirmação', () => {
    expect(() => replayOrder(book(), buy({ stop: 101 }), 100)).toThrow(ReplayError);
    expect(() => replayOrder(book(), buy({ type: 'limit', price: 101 }), 100)).toThrow(/ABAIXO/);
    let b = replayOrder(book(), buy(), 100);
    expect(() => replayOrder(b, buy(), 100)).toThrow(/pendente/);
    b = replayStep(b, bar(1, 100, 101, 99, 100), id);
    expect(() => replayOrder(b, buy(), 100)).toThrow(/uma por vez/);
    expect(() => replayMove(b, { stop: 90 }, T0 + D, 100)).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    const moved = replayMove(b, { stop: 90, confirmMovedBack: true }, T0 + D, 100);
    expect(moved.position).toMatchObject({ stop: 90, initialStop: 95, stopMovedBack: true });
    const fwd = replayMove(b, { stop: 97 }, T0 + D, 100);
    expect(fwd.position?.stopMovedBack).toBe(false);
  });

  it('com câmbio: caixa e resultado em R$; custos do treino aplicados', () => {
    const costs = { commissionPerOrder: 0, feePct: 0.001, slippageTicks: 1, spreadPct: 0 };
    let b = replayOrder(
      book({ fx: 5, costs, initialBalance: 100_000, cash: 100_000 }),
      buy({ qty: 10 }),
      100,
    );
    b = replayStep(b, bar(1, 100, 101, 99, 100), id);
    // compra a 100 + 1 tick = 100,01; taxa 0,1%
    expect(b.position?.avgPrice).toBe(100.01);
    expect(b.cash).toBeCloseTo(100_000 - 100.01 * 10 * 1.001 * 5, 6);
  });
});
