import { describe, expect, it } from 'vitest';
import { defaultTarget, distToSegment, extendRay, fibPrice, hitTest } from './geometry';
import { TimeIndex } from './time-index';

const DAY = 86_400_000;

describe('TimeIndex', () => {
  const times = [0, 1, 2, 3, 6, 7].map((d) => d * DAY); // fim de semana entre 3 e 6
  const ix = new TimeIndex(times);

  it('tempo exato vira índice inteiro e volta', () => {
    expect(ix.toLogical(6 * DAY)).toBe(4);
    expect(ix.toTime(4)).toBe(6 * DAY);
  });

  it('tempo entre candles vira índice fracionário', () => {
    expect(ix.toLogical(4.5 * DAY)).toBeCloseTo(3.5);
  });

  it('extrapola para o futuro com o espaçamento mediano', () => {
    expect(ix.toLogical(9 * DAY)).toBeCloseTo(7);
    expect(ix.toTime(7)).toBe(9 * DAY);
  });

  it('extrapola para antes do primeiro candle', () => {
    expect(ix.toLogical(-2 * DAY)).toBeCloseTo(-2);
  });
});

describe('geometria', () => {
  it('distância ao segmento', () => {
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it('raio vai até a borda direita', () => {
    expect(extendRay({ x: 0, y: 0 }, { x: 10, y: 10 }, 100)).toEqual({ x: 100, y: 100 });
  });

  it('Fibonacci: 0 no fim do movimento, 1 no início, 0,618 de retração', () => {
    expect(fibPrice(100, 200, 0)).toBe(200);
    expect(fibPrice(100, 200, 1)).toBe(100);
    expect(fibPrice(100, 200, 0.618)).toBeCloseTo(138.2);
  });

  it('alvo padrão da posição em 2R (compra e venda)', () => {
    expect(defaultTarget(50, 47)).toBe(56);
    expect(defaultTarget(20, 21)).toBe(18);
  });

  it('hit-test: alça tem prioridade sobre o corpo; linha horizontal tolera 6 px', () => {
    const data = {
      kind: 'trend' as const,
      points: [
        { time: 0, price: 0 },
        { time: 1, price: 1 },
      ],
    };
    const pr = {
      pts: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      width: 500,
      height: 300,
    };
    expect(hitTest(data, pr, { x: 2, y: 1 })).toBe(0);
    expect(hitTest(data, pr, { x: 50, y: 4 })).toBe('body');
    expect(hitTest(data, pr, { x: 50, y: 20 })).toBeNull();
    const h = { kind: 'hline' as const, points: [{ time: 0, price: 0 }] };
    expect(
      hitTest(h, { pts: [{ x: 250, y: 100 }], width: 500, height: 300 }, { x: 10, y: 105 }),
    ).toBe('body');
  });

  it('hit-test da zona estendida à direita', () => {
    const z = {
      kind: 'zone' as const,
      extendRight: true,
      points: [
        { time: 0, price: 0 },
        { time: 1, price: 1 },
      ],
    };
    const pr = {
      pts: [
        { x: 100, y: 100 },
        { x: 150, y: 140 },
      ],
      width: 500,
      height: 300,
    };
    expect(hitTest(z, pr, { x: 400, y: 120 })).toBe('body');
    expect(hitTest(z, pr, { x: 50, y: 120 })).toBeNull();
  });
});
