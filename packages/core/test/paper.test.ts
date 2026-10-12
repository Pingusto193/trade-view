import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COSTS,
  PriceTracker,
  exitHit,
  marketFill,
  orderFill,
  realized,
  type CostModel,
  type Interval,
} from '../src';

const T = Date.UTC(2026, 9, 12, 14, 0);
const M = 60_000;
const k = (i: number, o: number, h: number, l: number, c: number): Candle => ({
  time: T + i * M,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1,
});
const free: CostModel = { commissionPerOrder: 0, feePct: 0, slippageTicks: 0, spreadPct: 0 };
const iv = (first: number, high: number, low: number, last = first, newBar = false): Interval => ({
  first,
  high,
  low,
  last,
  time: T,
  newBar,
});

describe('PriceTracker: só conta o que negociou depois da última atualização', () => {
  it('máxima antiga do minuto não vale para quem entrou depois', () => {
    const p = new PriceTracker();
    p.seed(k(0, 100, 105, 99, 101)); // já foi a 105 antes
    // mesmo minuto, preço sobe para 102 sem renovar a máxima
    expect(p.update(k(0, 100, 105, 99, 102))).toEqual({
      first: 101,
      high: 102,
      low: 101,
      last: 102,
      time: T,
      newBar: false,
    });
    // renova a máxima: 106 negociou depois
    expect(p.update(k(0, 100, 106, 99, 104))!.high).toBe(106);
    // nada mudou: sem intervalo
    expect(p.update(k(0, 100, 106, 99, 104))).toBeNull();
  });

  it('candle novo: o intervalo começa na abertura (gap possível)', () => {
    const p = new PriceTracker();
    p.seed(k(0, 100, 101, 99, 100));
    expect(p.update(k(1, 103, 104, 102, 103.5))).toMatchObject({
      first: 103,
      high: 104,
      low: 102,
      newBar: true,
    });
    expect(p.update(k(0, 1, 1, 1, 1))).toBeNull(); // atualização velha
  });
});

describe('execução de ordens', () => {
  it('stop de compra: no gatilho; com gap, na abertura; derrapagem e spread contra', () => {
    const o = { id: 'o', side: 'buy' as const, type: 'stop' as const, qty: 10, price: 100 };
    expect(orderFill(o, iv(99, 99.5, 98.5), 0.01, 1, free)).toBeNull();
    expect(orderFill(o, iv(99, 100, 98.5), 0.01, 1, free)!.price).toBe(100);
    const gap = orderFill(o, iv(101, 102, 100.5, 101, true), 0.01, 1, free)!;
    expect(gap).toMatchObject({ price: 101, gap: true });
    const costs: CostModel = {
      commissionPerOrder: 5,
      feePct: 0.001,
      slippageTicks: 2,
      spreadPct: 0.0002,
    };
    const f = orderFill(o, iv(99, 100, 98.5), 0.01, 1, costs)!;
    // 100 + 0,01 (meio spread) + 0,02 (2 ticks) = 100,03
    expect(f.price).toBe(100.03);
    expect(f.fees).toBeCloseTo(100.03 * 10 * 0.001 + 5, 6);
    expect(f.slippage).toBeCloseTo(0.03, 6);
  });

  it('limitada: só executa se passar ALÉM do limite; abaixo na abertura, preço melhor', () => {
    const o = { id: 'o', side: 'buy' as const, type: 'limit' as const, qty: 1, price: 50 };
    expect(orderFill(o, iv(51, 52, 50), 0.01, 1, free)).toBeNull(); // só tocou
    expect(orderFill(o, iv(51, 52, 49.99), 0.01, 1, free)!.price).toBe(50);
    expect(orderFill(o, iv(49, 49.5, 48.5, 49, true), 0.01, 1, free)!.price).toBe(49);
  });

  it('a mercado: último preço + custos', () => {
    const f = marketFill('buy', 200, 3, 0.01, 1, DEFAULT_COSTS.b3);
    expect(f.price).toBe(200.01); // 1 tick
    expect(f.fees).toBeCloseTo(200.01 * 3 * 0.0003, 8);
  });
});

describe('stop e alvo da posição', () => {
  const pos = { qty: 10, avgPrice: 100, stop: 95, target: 110 };
  it('stop com gap executa na abertura; alvo com gap executa no alvo', () => {
    expect(exitHit(pos, iv(94, 96, 93, 94, true), false, 0.01, 1, free)).toMatchObject({
      kind: 'stop',
      price: 94,
      gap: true,
    });
    expect(exitHit(pos, iv(112, 113, 111, 112, true), false, 0.01, 1, free)).toMatchObject({
      kind: 'alvo',
      price: 110,
    });
  });
  it('stop e alvo no mesmo intervalo: stop primeiro; no intervalo da entrada só o stop', () => {
    expect(exitHit(pos, iv(100, 111, 94), false, 0.01, 1, free)!.kind).toBe('stop');
    expect(exitHit(pos, iv(100, 111, 96), true, 0.01, 1, free)).toBeNull();
    // alvo precisa passar além
    expect(exitHit(pos, iv(105, 110, 104), false, 0.01, 1, free)).toBeNull();
    expect(exitHit(pos, iv(105, 110.01, 104), false, 0.01, 1, free)!.kind).toBe('alvo');
  });
  it('resultado realizado desconta as taxas de saída', () => {
    expect(realized(100, 110, 10, 1, 3)).toBe(97);
    // mini-índice: R$ 0,20 por ponto
    expect(realized(120_000, 120_100, 2, 0.2, 0)).toBe(40);
  });
});
