import { BcbClient } from '@radar/data';
import type { LabRun } from '@radar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const DAY = 86_400_000;
const T0 = Date.UTC(2020, 0, 1);

/** Passeio aleatório determinístico. */
function walk(
  n: number,
): { time: number; open: number; high: number; low: number; close: number; volume: number }[] {
  let a = 12345;
  const r = () => (a = (a * 1103515245 + 12345) >>> 0) / 2 ** 32;
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    p = p * Math.exp(0.02 * (r() + r() + r() - 1.5));
    return {
      time: T0 + i * DAY,
      open: o,
      high: Math.max(o, p) * (1 + 0.005 * r()),
      low: Math.min(o, p) * (1 - 0.005 * r()),
      close: p,
      volume: 1000 + 1000 * r(),
    };
  });
}

/** CDI falso: 0,04% ao dia útil, rápido (sem rede). */
const bcb = new BcbClient({
  retries: 0,
  fetch: async (url: string) => {
    if (url.includes('ultimos')) return Response.json([{ data: '01/01/2020', valor: '10' }]);
    const m = /dataInicial=(\d\d)\/(\d\d)\/(\d{4})&dataFinal=(\d\d)\/(\d\d)\/(\d{4})/.exec(url)!;
    const from = Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!);
    const to = Date.UTC(+m[6]!, +m[5]! - 1, +m[4]!);
    const rows = [];
    for (let t = from; t <= to; t += DAY) {
      const d = new Date(t);
      if (d.getUTCDay() % 6 === 0) continue;
      rows.push({
        data: `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`,
        valor: '0.04',
      });
    }
    return Response.json(rows);
  },
});

describe('laboratório', () => {
  it('roda com dados da fonte, aplica o antiautoengano e registra cada tentativa', async () => {
    const t = await testApp({ bcb, now: () => T0 + 1600 * DAY });
    close = () => t.app.close();
    t.fake.candles = walk(1500);
    const body = { symbolId: 'fake:AAA', tf: '1d', setups: ['s91', 'elastic'], bars: 1500 };
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/lab/run',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });
    expect(res.statusCode).toBe(200);
    const run = res.json() as LabRun;
    expect(run.bars).toBe(1500);
    expect(run.metrics.trades).toBeGreaterThan(0);
    expect(run.train.trades + run.test.trades).toBe(run.metrics.trades);
    expect(['inconclusivo', 'evidência fraca', 'reprovado', 'promissor', 'aprovado']).toContain(
      run.verdict.label,
    );
    expect(run.verdict.reasons.length).toBeGreaterThan(0);
    expect(run.cdi?.acc).toBeGreaterThan(0.3); // ~4 anos de CDI a ~10% a.a.
    expect(run.sensitivity.map((s) => s.param)).toEqual(['s91.exit.targetR', 'elastic.bbStdDev']);
    expect(run.monteCarlo.runs).toBe(5000);
    expect(run.walkForward?.param).toBe('s91.exit.targetR');
    expect(run.walkForward?.folds).toHaveLength(5);
    expect(run.walkForward?.oosTrades).toBe(
      run.walkForward!.folds.reduce((s, f) => s + f.testTrades, 0),
    );
    expect(run.equity.length).toBeLessThanOrEqual(401);
    expect(run.dataNotes.some((n) => n.includes('viés de sobrevivência'))).toBe(true);
    expect(run.attempts).toBe(1);

    // segunda variação: o contador de tentativas sobe e a lista mostra as duas
    const res2 = await t.app.inject({
      method: 'POST',
      url: '/api/lab/run',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        ...body,
        params: { s91: { exit: { mode: 'fixed', targetR: 3 } } },
      }),
    });
    expect((res2.json() as LabRun).attempts).toBe(2);
    const list = (await t.app.inject({ url: '/api/lab/runs' })).json().runs;
    expect(list).toHaveLength(2);
    const again = (await t.app.inject({ url: `/api/lab/runs/${run.id}` })).json() as LabRun;
    expect(again.metrics).toEqual(run.metrics);
  });

  it('nenhum sinal vira trade: o veredito diz por quê (capital menor que o lote mínimo)', async () => {
    const t = await testApp({ bcb, now: () => T0 + 1600 * DAY });
    close = () => t.app.close();
    t.fake.candles = walk(1500).map((c) => ({
      ...c,
      open: c.open * 100,
      high: c.high * 100,
      low: c.low * 100,
      close: c.close * 100,
    }));
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/lab/run',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        symbolId: 'fake:AAA',
        tf: '1d',
        setups: ['s91'],
        bars: 1500,
        capital: 100,
      }),
    });
    expect(res.statusCode).toBe(200);
    const run = res.json() as LabRun;
    expect(run.metrics.trades).toBe(0);
    expect(run.verdict.label).toBe('inconclusivo');
    expect(run.verdict.reasons[0]).toMatch(/Nenhum sinal virou trade: risco não cabe no capital/);
  });

  it('setup desligado no gráfico continua testável; parâmetro fora do permitido é recusado', async () => {
    const t = await testApp({ bcb, now: () => T0 + 1600 * DAY });
    close = () => t.app.close();
    t.fake.candles = walk(1500);
    const post = (params?: unknown) =>
      t.app.inject({
        method: 'POST',
        url: '/api/lab/run',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ symbolId: 'fake:AAA', tf: '1d', setups: ['s91'], params }),
      });
    const base = (await post()).json() as LabRun;
    const off = (await post({ s91: { enabled: false } })).json() as LabRun;
    expect(base.metrics.trades).toBeGreaterThan(0);
    expect(off.metrics.trades).toBe(base.metrics.trades);
    const bad = await post({ s91: { exit: { mode: 'fixed', targetR: 50 } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/fora do permitido/);
  });

  it('poucos dados: recusa com explicação (nunca inventa)', async () => {
    const t = await testApp({ bcb });
    close = () => t.app.close();
    t.fake.candles = walk(50);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/lab/run',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ symbolId: 'fake:AAA', tf: '1d', setups: ['s91'] }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/pouco para um backtest/);
  });
});
