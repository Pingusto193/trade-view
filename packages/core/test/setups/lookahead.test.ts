import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP_PARAMS, detectSetups, setupParamsSchema } from '../../src';
import { DAY, T0 } from './helpers';

/** Gerador determinístico (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Passeio aleatório com regimes (alta, baixa, lateral) e gaps, para exercitar todos os setups. */
function walk(n: number, seed: number, start = 100): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const regime = Math.floor(i / 150) % 3;
    const drift = regime === 0 ? 0.004 : regime === 1 ? -0.004 : 0;
    const o = p * (1 + (r() - 0.5) * 0.01 + (r() < 0.03 ? (r() - 0.5) * 0.08 : 0));
    const c = o * (1 + drift + (r() - 0.5) * 0.04);
    const h = Math.max(o, c) * (1 + r() * 0.012);
    const l = Math.min(o, c) * (1 - r() * 0.012);
    out.push({
      time: T0 + i * DAY,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Math.round(1000 * (0.4 + r() * 1.5 + (r() < 0.05 ? 2 : 0))),
    });
    p = c;
  }
  return out;
}

const ALL = { ...DEFAULT_SETUP_PARAMS };
const WITH_SELLS = setupParamsSchema.parse({
  ...DEFAULT_SETUP_PARAMS,
  s91: { ...DEFAULT_SETUP_PARAMS.s91, allowSell: true, exit: { mode: 'dynamic', targetR: 2 } },
  s92: { ...DEFAULT_SETUP_PARAMS.s92, allowSell: true },
  s93: { ...DEFAULT_SETUP_PARAMS.s93, allowSell: true, consecutive: false },
  consolidation: { ...DEFAULT_SETUP_PARAMS.consolidation, entry: 'retest', requireVolume: false },
  elastic: { ...DEFAULT_SETUP_PARAMS.elastic, partialAt1R: true },
});

describe('sem look-ahead (SPEC §3.5, §12.3, §19)', () => {
  it('modo estrito: nenhum detector lê candle futuro', () => {
    for (const p of [ALL, WITH_SELLS]) {
      expect(() => detectSetups(walk(1200, 7), { params: p, strict: true })).not.toThrow();
    }
  });

  it('a série de teste gera eventos de todos os tipos de estado', () => {
    const evs = detectSetups(walk(1500, 11), { params: WITH_SELLS });
    const states = new Set(evs.map((e) => e.state));
    expect([...states].sort()).toEqual(['acionado', 'armado', 'encerrado', 'radar']);
    expect(new Set(evs.map((e) => e.setup)).size).toBeGreaterThanOrEqual(5);
  });

  for (const seed of [1, 2, 3]) {
    it(`alterar candles futuros não muda sinais passados (semente ${seed})`, () => {
      const base = walk(1200, seed);
      const full = detectSetups(base, { params: WITH_SELLS, strict: true });
      for (const k of [250, 600, 1000]) {
        const changed = [
          ...base.slice(0, k + 1),
          ...walk(1200 - k - 1, seed * 1000 + k, base[k]!.close * 1.3).map((c, i) => ({
            ...c,
            time: base[k + 1 + i]!.time,
          })),
        ];
        const alt = detectSetups(changed, { params: WITH_SELLS, strict: true });
        const past = (evs: typeof full) => evs.filter((e) => e.index <= k);
        expect(past(alt)).toEqual(past(full));
        // e o futuro realmente mudou (o teste não é trivial)
        expect(alt.filter((e) => e.index > k)).not.toEqual(full.filter((e) => e.index > k));
      }
    });
  }

  it('desempenho: 10 mil candles com todos os detectores em menos de 2 s', () => {
    const data = walk(10_000, 5);
    const t0 = performance.now();
    detectSetups(data, { params: WITH_SELLS });
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
