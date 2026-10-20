import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  READING_HORIZON,
  SIMPLE_PRESET,
  marketReading,
  readingStats,
  readingVerdict,
  type ReadingStats,
  type TrendLabel,
} from '../src';
import { Bars, T0, DAY } from './setups/helpers';

/** Ondas: 10 candles subindo 1,2 e 5 descendo 1,0 (o mesmo desenho do teste do painel de contexto). */
function waves(cycles: number): Bars {
  const b = new Bars();
  let c = 100;
  b.add(c, c + 0.5, c - 0.5, c);
  for (let k = 0; k < cycles; k++) {
    for (let i = 0; i < 10; i++) b.to((c += 1.2), { range: 1.2, v: 1200 });
    for (let i = 0; i < 5; i++) b.to((c -= 1.0), { range: 0.7, v: 700 });
  }
  return b;
}

const closes = (xs: number[]): Candle[] =>
  xs.map((c, i) => ({ time: T0 + i * DAY, open: c, high: c, low: c, close: c, volume: 1 }));

const stats = (cases: number, upPct: number | null): ReadingStats => ({
  cases,
  upPct,
  medianMovePct: null,
  from: null,
  to: null,
});

describe('readingStats: casos sem sobreposição e só com o futuro já conhecido', () => {
  const cs = closes([10, 11, 12, 11, 13, 14, 12]);
  const labels: TrendLabel[] = ['indefinida', 'alta', 'alta', 'baixa', 'alta', 'alta', 'alta'];

  it('pula "indefinida", não reaproveita a janela e para antes do fim', () => {
    const r = readingStats(cs, labels, 2, (l) => l === 'alta');
    // i=1 (11→11, não subiu), i=3 é baixa, i=4 (13→12, caiu); i=5 e 6 não têm 2 candles à frente
    expect(r.cases).toBe(2);
    expect(r.upPct).toBe(0);
    expect(r.from).toBe(T0 + 1 * DAY);
    expect(r.to).toBe(T0 + 4 * DAY);
  });

  it('régua de comparação: qualquer candle com tendência definida', () => {
    const r = readingStats(cs, labels, 2, () => true);
    // i=1 (11→11), i=3 (11→14 subiu); i=5 sem futuro
    expect(r.cases).toBe(2);
    expect(r.upPct).toBe(50);
    expect(r.medianMovePct).toBeCloseTo(((14 / 11 - 1) * 100) / 2, 9);
  });

  it('sem casos: números nulos (nunca inventar)', () => {
    const r = readingStats(cs.slice(0, 2), labels, 2, () => true);
    expect(r).toEqual({ cases: 0, upPct: null, medianMovePct: null, from: null, to: null });
  });
});

describe('readingVerdict: só fala em vantagem com amostra, diferença e z suficientes', () => {
  it('70% contra 50% em 100 casos: sobe mais que um candle qualquer', () => {
    const v = readingVerdict('alta', stats(100, 70), stats(400, 50));
    expect(v.verdict).toBe('sobe-mais');
    expect(v.z).toBeCloseTo(4, 9);
  });

  it('30% contra 50%: cai mais', () => {
    expect(readingVerdict('baixa', stats(100, 30), stats(400, 50)).verdict).toBe('cai-mais');
  });

  it('diferença pequena (3 pontos): sem vantagem', () => {
    expect(readingVerdict('alta', stats(100, 53), stats(400, 50)).verdict).toBe('sem-vantagem');
  });

  it('6 pontos de diferença, mas só 30 casos (z < 2): sem vantagem', () => {
    const v = readingVerdict('alta', stats(30, 56), stats(400, 50));
    expect(v.z).toBeLessThan(2);
    expect(v.verdict).toBe('sem-vantagem');
  });

  it('menos de 30 casos: poucos casos, mesmo com 80%', () => {
    expect(readingVerdict('alta', stats(20, 80), stats(400, 50)).verdict).toBe('poucos-casos');
  });

  it('tendência indefinida ou sem casos: sem dados', () => {
    expect(readingVerdict('indefinida', stats(100, 70), stats(400, 50)).verdict).toBe('sem-dados');
    expect(readingVerdict('alta', stats(0, null), stats(400, 50)).verdict).toBe('sem-dados');
  });
});

describe('marketReading (mesma regra de tendência do painel de contexto)', () => {
  it('ondas de alta curtas: tendência de alta, mas poucos casos para concluir', () => {
    const r = marketReading(waves(10).list)!;
    expect(r.trend).toBe('alta');
    expect(r.horizon).toBe(READING_HORIZON);
    expect(r.same.cases).toBeGreaterThan(0);
    expect(r.same.cases).toBeLessThan(30);
    expect(r.verdict).toBe('poucos-casos');
  });

  it('quando tudo sobe, a tendência não acrescenta nada: sem vantagem', () => {
    // qualquer janela de 10 candles destas ondas fecha mais alta: a régua também é 100%
    const r = marketReading(waves(40).list)!;
    expect(r.trend).toBe('alta');
    expect(r.same.cases).toBeGreaterThanOrEqual(30);
    expect(r.same.upPct).toBe(100);
    expect(r.base.upPct).toBe(100);
    expect(r.verdict).toBe('sem-vantagem');
  });

  it('sem look-ahead: a leitura num candle passado não muda com o que veio depois', () => {
    const b = waves(30);
    const L = 300;
    const cut = marketReading(b.list.slice(0, L + 1))!;
    const full = marketReading(b.list, { lastIndex: L })!;
    expect(full).toEqual(cut);
    // e mexer no futuro não altera nada
    const changed = b.list.map((c, i) =>
      i > L ? { ...c, close: c.close * 3, high: c.high * 3 } : c,
    );
    expect(marketReading(changed, { lastIndex: L })).toEqual(cut);
  });

  it('série lateral: tendência lateral; série curta: sem leitura', () => {
    const b = new Bars();
    for (let i = 0; i < 120; i++) b.to(100 + Math.sin(i / 3) * 0.8, { range: 1 });
    expect(marketReading(b.list)!.trend).toBe('lateral');
    expect(marketReading(b.list.slice(0, 30))).toBeNull();
  });

  it('repassa a tendência da escala maior (a escala maior manda)', () => {
    const r = marketReading(waves(10).list, { higherTrend: 'baixa', higherLabel: 'Semanal' })!;
    expect(r.higherTrend).toBe('baixa');
    expect(r.higherLabel).toBe('Semanal');
  });
});

describe('preset do modo simples', () => {
  it('só a MMA50 e o volume ligados', () => {
    const on = SIMPLE_PRESET.indicators.filter((i) => i.enabled).map((i) => i.id);
    expect(on.sort()).toEqual(['mma50', 'volume']);
  });
});
