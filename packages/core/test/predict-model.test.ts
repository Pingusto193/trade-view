import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREDICT,
  DEFAULT_SETUP_PARAMS,
  FeatureTracker,
  SituationTracker,
  fitLogistic,
  predictLogistic,
  predictReport,
  signalBacktest,
  walkForwardModel,
  type ScoredPrediction,
} from '../src';

const DAY = 86_400_000;
const T0 = Date.UTC(2010, 0, 4);

/** Gerador pseudoaleatório com semente (resultado igual em toda execução). */
function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function series(n: number, step: (i: number, rnd: () => number) => number, seed = 7): Candle[] {
  const rnd = lcg(seed);
  let c = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = c;
    c = c * (1 + step(i, rnd));
    return {
      time: T0 + i * DAY,
      open: o,
      high: Math.max(o, c) * 1.004,
      low: Math.min(o, c) * 0.996,
      close: c,
      volume: 1000 + rnd() * 500,
    };
  });
}
const randomWalk = (n: number) => series(n, (_, r) => (r() - 0.5) * 0.04);
/** Série com padrão determinístico (previsível de propósito). */
const pattern = (n: number) => series(n, (i) => (Math.sin(i * 1.7) + Math.cos(i * 0.31)) * 0.01);

function featuresOf(cs: Candle[]) {
  const tr = new SituationTracker({ tf: '1d', tz: 'America/Sao_Paulo' });
  const ft = new FeatureTracker(DEFAULT_SETUP_PARAMS.pa);
  return cs.map((c) => ft.push(c, tr.push(c), tr.engine.series));
}

describe('regressão logística', () => {
  it('acha o sinal certo e dá probabilidades entre 0 e 1; feature constante não quebra', () => {
    const rnd = lcg(3);
    const X: number[][] = [];
    const y: boolean[] = [];
    for (let i = 0; i < 2000; i++) {
      const a = rnd() * 2 - 1;
      const b = rnd() * 2 - 1;
      X.push([a, b, 5]); // terceira coluna constante
      y.push(a + 0.3 * (rnd() - 0.5) > 0);
    }
    const m = fitLogistic(X, y, { l2: 1 });
    expect(m.converged).toBe(true);
    expect(m.iters).toBeLessThan(15);
    expect(m.w[0]!).toBeGreaterThan(2);
    expect(Math.abs(m.w[1]!)).toBeLessThan(0.3);
    expect(m.w[2]).toBeCloseTo(0, 6);
    expect(predictLogistic(m, [0.8, 0, 5])).toBeGreaterThan(0.9);
    expect(predictLogistic(m, [-0.8, 0, 5])).toBeLessThan(0.1);
  });
});

describe('walk-forward com purga e embargo', () => {
  const cs = randomWalk(1400);
  const feats = featuresOf(cs);
  const closes = cs.map((c) => c.close);
  const times = cs.map((c) => c.time);

  it('sem look-ahead: mudar tudo depois de T não muda nenhuma previsão feita até T', () => {
    const T = 1000;
    const a = walkForwardModel(feats, closes, times, 5);
    const rnd = lcg(99);
    const closes2 = closes.map((c, i) => (i > T ? c * (0.5 + rnd()) : c));
    const feats2 = feats.map((x, i) => (i > T && x ? x.map(() => rnd() * 10 - 5) : x));
    const b = walkForwardModel(feats2, closes2, times, 5);
    const upTo = (r: typeof a) =>
      r.points.filter((p) => p.time <= times[T - 5]!).map((p) => [p.time, p.p]);
    expect(upTo(a).length).toBeGreaterThan(50);
    expect(upTo(b)).toEqual(upTo(a));
  });

  it('primeiro ponto só depois do aquecimento + treino mínimo + purga + embargo', () => {
    const h = 20;
    const r = walkForwardModel(feats, closes, times, h);
    const firstValid = feats.findIndex(Boolean);
    const first = times.indexOf(r.points[0]!.time);
    expect(first).toBeGreaterThanOrEqual(
      firstValid + DEFAULT_PREDICT.minTrain + h + DEFAULT_PREDICT.embargo - 1,
    );
    // pontos sem sobreposição
    for (let k = 1; k < r.points.length; k++)
      expect(
        times.indexOf(r.points[k]!.time) - times.indexOf(r.points[k - 1]!.time),
      ).toBeGreaterThanOrEqual(h);
  });

  it('passeio aleatório: SEM VANTAGEM; padrão determinístico: vantagem (o teste distingue)', () => {
    const rw = predictReport(randomWalk(2000), { tf: '1d', tz: 'America/Sao_Paulo' })!;
    for (const h of rw.horizons) {
      expect(h.model.history.verdict).not.toBe('vantagem');
      expect(h.history.verdict).not.toBe('vantagem');
    }
    const pt = predictReport(pattern(2000), { tf: '1d', tz: 'America/Sao_Paulo' })!;
    expect(pt.horizons[0]!.model.history.verdict).toBe('vantagem');
    expect(pt.horizons[0]!.model.current).not.toBeNull();
    expect(pt.horizons[0]!.model.current!.coefficients).toHaveLength(19);
  });
});

describe('resultado em dinheiro do sinal', () => {
  const cs: Candle[] = [100, 102, 101, 105, 104, 108].map((c, i) => ({
    time: Date.UTC(2026, 0, 5 + i, 3),
    open: c - 1,
    high: c + 1,
    low: c - 2,
    close: c,
    volume: 1,
  }));
  const pt = (i: number, p: number): ScoredPrediction => ({
    time: cs[i]!.time,
    p,
    alwaysUpP: 0.5,
    persistUp: null,
    up: true,
  });

  it('compra na abertura seguinte, vende no fechamento do alvo; custos; perto de 50% fica de fora', () => {
    const meta = {
      tick: 0.01,
      pointValue: 1,
      minQty: 0.0001,
      qtyStep: 0.0001,
      market: 'crypto' as const,
    };
    const r = signalBacktest(cs, [pt(0, 0.7), pt(2, 0.52)], 1, meta, {
      ...DEFAULT_PREDICT,
      capital: 1000,
    });
    expect(r.skipped).toBe(1); // 52% < 50% + 5 pp
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0]!;
    // entrada: abertura do candle 1 (101) + metade do spread de 0,02%
    expect(t.entry).toBeCloseTo(101 * (1 + 0.0001), 2);
    expect(t.exit).toBeCloseTo(102 * (1 - 0.0001), 2);
    expect(t.fees).toBeCloseTo((t.entry + t.exit) * t.qty * 0.001, 6);
    expect(r.tax).toBeNull(); // fora da B3 o IR não é simulado
    expect(r.notes.join(' ')).toMatch(/IR fora da B3/);
  });

  it('B3: ações em swing com venda abaixo de R$ 20 mil isentas; futuros pagam 15% (1 contrato)', () => {
    const p = { ...DEFAULT_PREDICT, capital: 10_000 };
    const acao = signalBacktest(
      cs,
      [pt(1, 0.8)],
      2,
      {
        tick: 0.01,
        pointValue: 1,
        minQty: 1,
        qtyStep: 1,
        market: 'b3',
      },
      p,
    );
    expect(acao.trades[0]!.pnl).toBeGreaterThan(0);
    expect(acao.tax).toBe(0);
    const fut = signalBacktest(
      cs,
      [pt(1, 0.8)],
      2,
      {
        tick: 1,
        pointValue: 50,
        minQty: 1,
        qtyStep: 1,
        market: 'b3',
      },
      p,
    );
    expect(fut.trades[0]!.qty).toBe(1);
    expect(fut.tax).toBeCloseTo(fut.trades[0]!.pnl * 0.15 - fut.trades[0]!.exit * 50 * 0.00005, 2);
    expect(fut.notes.join(' ')).toMatch(/1 contrato/);
  });
});
