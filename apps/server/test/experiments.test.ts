import type { ExperimentRun } from '@radar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { experimentRuns } from '../src/db/schema';
import { ExperimentService } from '../src/experiments/service';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const DAY = 86_400_000;
const T0 = Date.UTC(2015, 0, 1);

/** Passeio aleatório determinístico (diário). */
function walk(n: number) {
  let a = 987654;
  const r = () => (a = (a * 1103515245 + 12345) >>> 0) / 2 ** 32;
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    p = p * Math.exp(0.02 * (r() + r() + r() - 1.5));
    return {
      time: T0 + i * DAY,
      open: o,
      high: Math.max(o, p) * (1 + 0.006 * r()),
      low: Math.min(o, p) * (1 - 0.006 * r()),
      close: p,
      volume: 1000 + 1000 * r(),
    };
  });
}

async function setup() {
  const t = await testApp({ now: () => T0 + 2700 * DAY });
  close = () => t.app.close();
  t.fake.candles = walk(2600);
  // portão: segura a fonte até o teste liberar (para ver a execução "rodando")
  let open: () => void = () => {};
  let gate = Promise.resolve();
  const hold = () => (gate = new Promise<void>((ok) => (open = ok)));
  const orig = t.fake.getCandles.bind(t.fake);
  t.fake.getCandles = async (req) => {
    await gate;
    return orig(req);
  };
  const post = (id: string, symbols: string[]) =>
    t.app.inject({
      method: 'POST',
      url: `/api/experiments/${id}/run`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ symbols }),
    });
  const finish = async (run: ExperimentRun) => {
    await t.experiments.wait(run.id);
    return (await t.app.inject({ url: `/api/experiments/runs/${run.id}` })).json() as ExperimentRun;
  };
  return { t, post, finish, hold, release: () => open() };
}

describe('experimentos (SPEC §12.4)', () => {
  it('E1: duas variantes no mesmo detector, ativo sem dados vira linha de erro, resumo pelos números', async () => {
    const { t, post, finish, hold, release } = await setup();
    hold();
    const res = await post('e1', ['fake:AAA', 'fake:BBB', 'nada:XYZ']);
    expect(res.statusCode).toBe(200);
    const started = res.json() as ExperimentRun;
    expect(started.status).toBe('running');
    // uma execução por vez
    expect((await post('e2', ['fake:AAA'])).statusCode).toBe(409);
    release();

    const run = await finish(started);
    expect(run.status).toBe('done');
    expect(run.progress).toEqual({ done: 3, total: 3 });
    const r = run.result!;
    if (r.kind !== 'variants') throw new Error('tipo errado');
    expect(r.variants.map((v) => v.key)).toEqual(['sem', 'com']);
    for (const v of r.variants) {
      expect(v.perSymbol).toHaveLength(3);
      expect(v.perSymbol.find((p) => p.symbolId === 'nada:XYZ')?.error).toBeTruthy();
      expect(v.pooled.trades).toBe(v.perSymbol.reduce((s, p) => s + p.trades, 0));
      expect(v.test.trades).toBeLessThanOrEqual(v.pooled.trades);
    }
    // sem filtro há pelo menos tantos sinais quanto com filtro
    expect(r.variants[0]!.pooled.trades).toBeGreaterThanOrEqual(r.variants[1]!.pooled.trades);
    expect(r.comparisons).toHaveLength(1);
    expect(run.summary).toMatch(/de 1 diferença passou do barulho do acaso|Amostra insuficiente/);
    expect(run.dataNotes.some((n) => n.includes('só compras'))).toBe(true);

    const latest = (await t.app.inject({ url: '/api/experiments' })).json().latest;
    expect(latest.e1.id).toBe(run.id);
  });

  it('E2: caudas da Bollinger com as duas réguas de "mundo normal"', async () => {
    const { post, finish } = await setup();
    const run = await finish((await post('e2', ['fake:AAA'])).json() as ExperimentRun);
    expect(run.status).toBe('done');
    const r = run.result!;
    if (r.kind !== 'tails') throw new Error('tipo errado');
    const row = r.rows[0]!;
    expect(row.closes).toBe(2600 - 19);
    expect(row.normalPerSide).toBeCloseTo(0.00135, 5);
    expect(row.randomWalkPerSide).toBeGreaterThan(0);
    expect(run.summary).toMatch(/curva normal: 0,13%/);
  });

  it('E6: só calcula nas escalas que a fonte oferece; IR fora da B3 não simulado', async () => {
    const { post, finish } = await setup();
    const run = await finish((await post('e6', ['fake:AAA'])).json() as ExperimentRun);
    const r = run.result!;
    if (r.kind !== 'costs') throw new Error('tipo errado');
    const day = r.rows.find((x) => x.tf === '1d')!;
    expect(day.modality).toBe('swing');
    expect(day.taxRate).toBeNull();
    expect(day.grossR).toBeCloseTo(0.2, 10);
    expect(day.netR!).toBeLessThan(0.2);
    expect(r.rows.find((x) => x.tf === '5m')!.error).toMatch(/não oferece/);
    expect(run.dataNotes.some((n) => n.includes('IR de cripto'))).toBe(true);
  });

  it('servidor reiniciado no meio: a execução vira erro com explicação (não fica "rodando" para sempre)', async () => {
    const { t, post, hold, release } = await setup();
    hold();
    const started = (await post('e1', ['fake:AAA'])).json() as ExperimentRun;
    const row = t.db.select().from(experimentRuns).get()!;
    expect(row.status).toBe('running');
    const fresh = new ExperimentService(t.db, t.market);
    const got = fresh.get(row.userId, started.id);
    expect(got?.status).toBe('error');
    expect(got?.error).toMatch(/reiniciou/);
    release();
    await t.experiments.wait(started.id);
  });
});
