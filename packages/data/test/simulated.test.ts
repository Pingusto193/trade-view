import { describe, expect, it } from 'vitest';
import { SimulatedAdapter } from '../src';

const NOW = Date.UTC(2026, 9, 12, 15);

describe('simulador (somente desenvolvimento)', () => {
  const sim = new SimulatedAdapter(() => NOW);

  it('é determinístico: a mesma consulta devolve os mesmos candles', async () => {
    const a = await sim.getCandles({ symbol: 'SIMACAO', tf: '1d', limit: 300 });
    const b = await sim.getCandles({ symbol: 'SIMACAO', tf: '1d', limit: 300 });
    expect(a).toEqual(b);
  });

  it('o diário parece passeio aleatório: sem zigue-zague artificial entre dias', async () => {
    const c = await sim.getCandles({ symbol: 'SIMACAO', tf: '1d', limit: 2000 });
    const ret = c.slice(1).map((k, i) => Math.log(k.close / c[i]!.close));
    const mean = ret.reduce((s, x) => s + x, 0) / ret.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < ret.length; i++) {
      den += (ret[i]! - mean) ** 2;
      if (i > 0) num += (ret[i]! - mean) * (ret[i - 1]! - mean);
    }
    // antes: autocorrelação −0,885 (um termo periódico de ~2 dias); passeio aleatório ≈ 0
    expect(Math.abs(num / den)).toBeLessThan(0.1);
    // corpos alternando de sinal ~50% das vezes, não 89%
    let flips = 0;
    for (let i = 1; i < c.length; i++) {
      if (Math.sign(c[i]!.close - c[i]!.open) !== Math.sign(c[i - 1]!.close - c[i - 1]!.open))
        flips++;
    }
    expect(flips / (c.length - 1)).toBeLessThan(0.62);
    for (const k of c) {
      expect(k.high).toBeGreaterThanOrEqual(Math.max(k.open, k.close));
      expect(k.low).toBeLessThanOrEqual(Math.min(k.open, k.close));
    }
  });

  it('1 minuto agregado termina o dia perto do fechamento diário', async () => {
    const d = await sim.getCandles({ symbol: 'SIMACAO', tf: '1d', limit: 3 });
    const m = await sim.getCandles({ symbol: 'SIMACAO', tf: '60m', limit: 48 });
    const yesterday = d.at(-2)!;
    const lastHourOfYesterday = m.filter((k) => k.time < yesterday.time + 86_400_000).at(-1)!;
    expect(Math.abs(Math.log(lastHourOfYesterday.close / yesterday.close))).toBeLessThan(0.03);
  });
});
