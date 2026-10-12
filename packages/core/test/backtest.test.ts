import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  detectSetups,
  drawdown,
  monteCarlo,
  rng,
  runBacktest,
  splitTrades,
  type BacktestConfig,
  type BacktestResult,
  type BtTrade,
} from '../src';

const DAY = 86_400_000;
const T0 = Date.UTC(2015, 0, 1);

/** Passeio aleatório determinístico (diário). */
function walk(n: number, seed: number): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const g = Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
    const o = p;
    p = p * Math.exp(0.015 * g);
    const hi = Math.max(o, p) * (1 + 0.006 * r());
    const lo = Math.min(o, p) * (1 - 0.006 * r());
    out.push({
      time: T0 + i * DAY,
      open: o,
      high: hi,
      low: lo,
      close: p,
      volume: 1000 + 500 * r(),
    });
  }
  return out;
}

const free = { commissionPerOrder: 0, feePct: 0, slippageTicks: 0, spreadPct: 0 };
const cfg = (over: Partial<BacktestConfig> = {}): BacktestConfig => ({
  setups: ['s91', 's92', 'elastic'],
  tf: '1d',
  tz: 'UTC',
  meta: { tick: 0.01, pointValue: 1, lotSize: 1, minQty: 1, qtyStep: 1, market: 'us' },
  capital: 100_000,
  riskPct: 1,
  costs: free,
  ...over,
});

describe('backtest', () => {
  const candles = walk(2500, 7);

  it('só compras: sinais de venda viram "pulados" com o motivo, nunca trade', () => {
    const both = runBacktest(candles, cfg());
    const sells = both.trades.filter((t) => t.side === 'sell').length;
    expect(sells).toBeGreaterThan(0);
    const long = runBacktest(candles, cfg({ longOnly: true }));
    expect(long.trades.every((t) => t.side === 'buy')).toBe(true);
    expect(long.skipped['venda (apostar na queda) desligada']).toBeGreaterThanOrEqual(sells);
  });

  it('sem custos, o R de cada trade bate com o do detector (mesma lógica, sem duplicar)', () => {
    const r = runBacktest(candles, cfg());
    expect(r.trades.length).toBeGreaterThan(20);
    const events = detectSetups(candles, { tf: '1d', tz: 'UTC', only: ['s91', 's92', 'elastic'] });
    for (const t of r.trades.filter((x) => x.exitKind !== 'fim-dos-dados')) {
      const ev = events.find((e) => e.id === t.occurrence && e.state === 'encerrado');
      expect(ev?.resultR).toBeDefined();
      // tamanho arredondado em unidades inteiras: R líquido = R do detector
      expect(t.r).toBeCloseTo(ev!.resultR!, 6);
    }
  });

  it('custos sempre pioram o resultado (o treino/backtest não pode parecer melhor que o real)', () => {
    const a = runBacktest(candles, cfg());
    const b = runBacktest(
      candles,
      cfg({
        costs: { commissionPerOrder: 1, feePct: 0.0005, slippageTicks: 2, spreadPct: 0.0005 },
      }),
    );
    const byOcc = new Map(a.trades.map((t) => [t.occurrence, t]));
    let compared = 0;
    for (const t of b.trades) {
      const z = byOcc.get(t.occurrence);
      if (!z) continue;
      compared++;
      expect(t.r).toBeLessThan(z.r);
      expect(t.fees).toBeGreaterThan(0);
    }
    expect(compared).toBeGreaterThan(10);
  });

  it('uma posição por vez; sinais ignorados ficam contados', () => {
    const r = runBacktest(candles, cfg());
    for (let i = 1; i < r.trades.length; i++) {
      expect(r.trades[i]!.entryIndex).toBeGreaterThanOrEqual(r.trades[i - 1]!.exitIndex);
    }
    expect(Object.values(r.skipped).reduce((s, x) => s + x, 0)).toBeGreaterThan(0);
  });

  it('sem alavancagem: o valor comprado nunca passa do patrimônio', () => {
    const r = runBacktest(candles, cfg({ riskPct: 10 }));
    for (const t of r.trades) expect(t.qty * t.entry).toBeLessThanOrEqual(150_000 * 20);
    const tight = runBacktest(candles, cfg({ riskPct: 50 }));
    let eq = 100_000;
    for (const t of tight.trades) {
      expect(t.qty * t.entry).toBeLessThanOrEqual(eq + 1e-6);
      eq += t.pnl;
    }
  });
});

describe('métricas', () => {
  const trade = (pnl: number, i: number): BtTrade => ({
    setup: 's91',
    side: 'buy',
    occurrence: String(i),
    entryIndex: i * 10,
    entryTime: T0 + i * 40 * DAY,
    exitIndex: i * 10 + 4,
    exitTime: T0 + (i * 40 + 4) * DAY,
    signalEntry: 100,
    entry: 100,
    signalExit: 100,
    exit: 100,
    stop: 95,
    qty: 10,
    risk: 50,
    fees: 1,
    pnl,
    r: pnl / 50,
    exitKind: 'stop',
    againstHigher: false,
  });

  it('acerto, payoff, fator de lucro, sequência de perdas e amostra', () => {
    const trades = [100, -50, -50, 200].map(trade);
    const r: BacktestResult = {
      trades,
      skipped: {},
      equity: [
        { time: T0, equity: 1000 },
        { time: T0 + 10 * DAY, equity: 1100 },
        { time: T0 + 20 * DAY, equity: 1000 },
        { time: T0 + 400 * DAY, equity: 1200 },
      ],
      barsInMarket: 20,
      bars: 40,
      from: T0,
      to: T0 + 400 * DAY,
      initialCapital: 1000,
      buyHold: { ret: 0, qty: 0 },
    };
    const m = computeMetrics(r, { pointValue: 1 });
    expect(m).toMatchObject({
      trades: 4,
      wins: 2,
      losses: 2,
      winRate: 0.5,
      payoff: 3,
      profitFactor: 3,
    });
    expect(m.longestLosingStreak).toBe(2);
    expect(m.expectancyR).toBeCloseTo(1, 9); // (2 −1 −1 +4)/4
    expect(m.exposure).toBe(0.5);
    expect(m.totalReturn).toBeCloseTo(0.2, 9);
    expect(m.sample).toBe('inconclusivo');
    const { train, test } = splitTrades(r, 0.5);
    expect(train.length + test.length).toBe(4);
  });

  it('drawdown: profundidade e tempo até recuperar', () => {
    const d = drawdown([
      { time: T0, equity: 100 },
      { time: T0 + 10 * DAY, equity: 120 },
      { time: T0 + 20 * DAY, equity: 90 },
      { time: T0 + 50 * DAY, equity: 130 },
    ]);
    expect(d.max).toBeCloseTo(0.25, 9);
    expect(d.days).toBe(40);
  });

  it('IR da B3 entra quando pedido (swing com vendas acima de R$ 20 mil)', () => {
    const t = { ...trade(1000, 1), qty: 300, exit: 110 }; // venda de R$ 33.000
    const r: BacktestResult = {
      trades: [t],
      skipped: {},
      equity: [
        { time: T0, equity: 100_000 },
        { time: T0 + 60 * DAY, equity: 101_000 },
      ],
      barsInMarket: 1,
      bars: 2,
      from: T0,
      to: T0 + 60 * DAY,
      initialCapital: 100_000,
      buyHold: { ret: 0, qty: 0 },
    };
    const m = computeMetrics(r, { pointValue: 1, taxB3: true });
    expect(m.tax).toBeCloseTo(1000 * 0.15 - 33_000 * 0.00005, 6);
    expect(m.totalReturnAfterTax!).toBeLessThan(m.totalReturn);
  });
});

describe('Monte Carlo', () => {
  it('é reprodutível e coerente nos casos extremos', () => {
    const a = monteCarlo([1, -1, 2, -1], 1, { runs: 500, seed: 1 });
    const b = monteCarlo([1, -1, 2, -1], 1, { runs: 500, seed: 1 });
    expect(a).toEqual(b);
    const up = monteCarlo(Array(30).fill(1), 1, { runs: 100 });
    expect(up.drawdown.p95).toBe(0);
    expect(up.finalReturn.p50).toBeCloseTo(1.01 ** 30 - 1, 9);
    const down = monteCarlo(Array(50).fill(-1), 1, { runs: 100 });
    expect(down.finalReturn.p50).toBeCloseTo(0.99 ** 50 - 1, 9);
    expect(down.probLoss.find((x) => x.at === 0.3)!.p).toBe(1);
  });
});
