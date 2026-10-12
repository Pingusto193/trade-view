import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import { bollingerTails, costDrag, drawdownBuys, normalTail, pooled, rng, welch } from '../src';

const DAY = 86_400_000;

function series(closes: readonly number[]): Candle[] {
  return closes.map((c, i) => ({
    time: i * DAY,
    open: c,
    high: c * 1.001,
    low: c * 0.999,
    close: c,
    volume: 1,
  }));
}

/** Passeio com retornos normais (σ dado) ou com caudas gordas (mistura com saltos raros). */
function walk(n: number, sigma: number, seed: number, jumps = 0): number[] {
  const r = rng(seed);
  const out: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const g = Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
    const jump = jumps && r() < jumps ? (r() < 0.5 ? -1 : 1) * 8 * sigma : 0;
    p *= Math.exp(sigma * g + jump);
    out.push(p);
  }
  return out;
}

describe('E2 — caudas da Bollinger', () => {
  it('curva normal teórica: 0,135% por lado além de 3 desvios', () => {
    expect(normalTail(3)).toBeCloseTo(0.0013499, 6);
    expect(normalTail(0)).toBeCloseTo(0.5, 6);
  });

  it('num passeio normal a taxa fica perto do passeio de referência; com saltos, bem acima', () => {
    const normal = bollingerTails(series(walk(6000, 0.01, 1)));
    const fat = bollingerTails(series(walk(6000, 0.01, 1, 0.01)));
    const rate = (x: typeof normal) => (x.rateAbove + x.rateBelow) / 2;
    expect(normal.closes).toBe(6000 - 19);
    expect(rate(normal)).toBeLessThan(normal.randomWalkPerSide * 2.5);
    expect(rate(fat)).toBeGreaterThan(rate(normal));
    expect(normal.randomWalkPerSide).toBeGreaterThan(0);
  });

  it('volta à média: conta só se tocar a média central em até N candles', () => {
    // 30 candles parados, um salto para cima (fecha fora), depois volta ao nível
    const closes = [...Array(30).fill(100), 130, 129, 128, 100, 100, 100];
    const t = bollingerTails(series(closes), { horizon: 2 });
    expect(t.above).toBe(1);
    expect(t.backToMean.events).toBe(1);
    expect(t.backToMean.within).toBe(0); // só voltou no 3º candle
    const t3 = bollingerTails(series(closes), { horizon: 3 });
    expect(t3.backToMean.within).toBe(1);
  });
});

describe('E6 — 40% de acerto com 1:2 depois de custos e IR', () => {
  const flat = series(Array.from({ length: 200 }, (_, i) => 100 + (i % 2)));
  it('sem custos: +0,2 R por trade e empate em 33,3% de acerto', () => {
    const r = costDrag(flat, {
      costs: { commissionPerOrder: 0, feePct: 0, slippageTicks: 0, spreadPct: 0 },
      tick: 0.01,
      taxRate: 0,
    });
    expect(r.grossR).toBeCloseTo(0.2, 10);
    expect(r.netR).toBeCloseTo(0.2, 10);
    expect(r.breakEvenWinRate).toBeCloseTo(1 / 3, 10);
  });

  it('stop curto (escala pequena) faz o custo em R explodir', () => {
    const costs = { commissionPerOrder: 0, feePct: 0.0005, slippageTicks: 1, spreadPct: 0.0005 };
    const wide = series(walk(300, 0.02, 3));
    const tight = series(walk(300, 0.002, 3));
    const a = costDrag(wide, { costs, tick: 0.01, taxRate: 0.15 });
    const b = costDrag(tight, { costs, tick: 0.01, taxRate: 0.2 });
    expect(b.costR).toBeGreaterThan(a.costR * 3);
    expect(b.netR).toBeLessThan(a.netR);
    expect(b.breakEvenWinRate).toBeGreaterThan(a.breakEvenWinRate);
    // IR só sobre resultado positivo
    if (a.netR > 0) expect(a.afterTaxR).toBeCloseTo(a.netR * 0.85, 10);
    if (b.netR <= 0) expect(b.afterTaxR).toBe(b.netR);
  });
});

describe('comparação entre variantes', () => {
  it('pool de R e teste de Welch', () => {
    const a = [-1, -1, 2, -1, 2, -1, -1, 2, -1, -1];
    const p = pooled(a);
    expect(p.trades).toBe(10);
    expect(p.winRate).toBeCloseTo(0.3, 10);
    expect(p.expectancyR).toBeCloseTo(-0.1, 10);
    expect(p.profitFactorR).toBeCloseTo(6 / 7, 10);
    expect(welch(a, a)?.meaningful).toBe(false);
    const b = Array.from({ length: 200 }, (_, i) => (i % 2 ? 2 : -0.5));
    const big = Array.from({ length: 200 }, (_, i) => (i % 3 ? -1 : 1));
    const d = welch(big, b)!;
    expect(d.diffR).toBeGreaterThan(0);
    expect(d.meaningful).toBe(true);
    expect(welch([1], b)).toBeNull();
  });
});

describe('E7 — comprar a −50% do topo', () => {
  it('compra no primeiro fechamento a −50% e não recompra a mesma queda', () => {
    const closes = [100, 90, 70, 49, 45, 40, 48, 60, 49, 70, 80];
    const buys = drawdownBuys(series(closes), { hold: 3 });
    expect(buys).toHaveLength(1);
    expect(buys[0]!.index).toBe(3);
    expect(buys[0]!.ret).toBeCloseTo(48 / 49 - 1, 10);
    expect(buys[0]!.worst).toBeCloseTo((40 * 0.999) / 49 - 1, 10);
  });
});
