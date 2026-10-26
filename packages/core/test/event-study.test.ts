import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import { eventStudy } from '../src';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 26, 13);
/** Candles de 1 hora com os fechamentos dados. */
const bars = (closes: number[]): Candle[] =>
  closes.map((c, i) => ({ time: T0 + i * H, open: c, high: c, low: c, close: c, volume: 1 }));

describe('estudo de evento', () => {
  // 0..5 parado em 100; o 6 (onde sai a notícia) vai a 101; 7 a 103; depois para em 104
  const cs = bars([100, 100, 100, 100, 100, 100, 101, 103, 104, 104, 104, 104]);

  it('mede depois da publicação a partir do último candle fechado e o quanto já tinha andado na chegada', () => {
    const r = eventStudy(
      cs,
      [
        {
          publishedAt: T0 + 6 * H + 10 * 60_000, // dentro do candle 6 → referência = fechamento do 5
          arrivedAt: T0 + 8 * H + 5 * 60_000, // chegou com o candle 7 fechado
          groups: ['juros-br'],
        },
      ],
      { tfMs: H, horizons: [2] },
    );
    const g = r.groups[0]!.horizons[0]!;
    expect(g.n).toBe(1);
    expect(g.medianMove).toBeCloseTo(103 / 100 - 1, 12); // fechamento 7 ÷ fechamento 5
    expect(g.shareBeforeArrival).toBeCloseTo(1, 12); // tudo já tinha acontecido na chegada
    expect(g.medianAfterArrival).toBeCloseTo(104 / 103 - 1, 12); // o que sobrou: 7 → 9
    expect(g.upRate).toBe(1);
  });

  it('casos do mesmo grupo não se sobrepõem; sem hora de chegada não entra na fração', () => {
    const r = eventStudy(
      cs,
      [
        { publishedAt: T0 + 2 * H + 1, arrivedAt: null, groups: ['x'] },
        { publishedAt: T0 + 3 * H + 1, arrivedAt: null, groups: ['x'] },
        { publishedAt: T0 + 30 * H, arrivedAt: null, groups: ['x'] }, // depois dos candles
      ],
      { tfMs: H, horizons: [5] },
    );
    const g = r.groups[0]!.horizons[0]!;
    expect(g.n).toBe(1);
    expect(g.nArrival).toBe(0);
    expect(g.shareBeforeArrival).toBeNull();
    expect(r.outside).toBe(1);
  });

  it('régua de um candle qualquer e comparação de tamanho', () => {
    const r = eventStudy(cs, [{ publishedAt: T0 + 6 * H + 1, arrivedAt: null, groups: ['x'] }], {
      tfMs: H,
      horizons: [1],
    });
    const base = r.baseline[0]!;
    expect(base.n).toBe(11);
    const g = r.groups[0]!.horizons[0]!;
    // evento: fechamento 5 → 6 (+1%); qualquer candle: média de |movimento| no período
    expect(g.vsBaseline).toBeCloseTo(0.01 / base.meanAbsMove!, 9);
    expect(g.vsBaseline!).toBeGreaterThan(1);
  });
});
