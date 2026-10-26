import type { Candle } from '@radar/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { predictions } from '../src/db/schema';
import { DAY, testApp } from './helpers';

const T0 = Date.UTC(2025, 0, 1);

/** Ondas: 10 dias subindo e 5 caindo (tem tendência, ADX e Bollinger de verdade). */
function waves(n: number): Candle[] {
  const out: Candle[] = [];
  let c = 100;
  for (let i = 0; i < n; i++) {
    const o = c;
    c += i % 15 < 10 ? 1.2 : -1;
    out.push({
      time: T0 + i * DAY,
      open: o,
      high: Math.max(o, c) + 0.5,
      low: Math.min(o, c) - 0.5,
      close: c,
      volume: 1000,
    });
  }
  return out;
}

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function setup(n = 300) {
  const all = waves(n + 40);
  let now = all[n - 1]!.time + DAY + 3_600_000; // 1 h depois do fechamento do último candle
  const t = await testApp({ now: () => now });
  close = () => t.app.close();
  t.fake.candles = all.slice(0, n);
  const push = (c: Candle, closed: boolean) => {
    for (const h of t.fake.handlers) h.onCandle({ candle: c, closed });
  };
  const add = await t.app.inject({
    method: 'POST',
    url: '/api/predict/targets',
    payload: { symbolId: 'fake:AAA', tf: '1d' },
  });
  expect(add.statusCode).toBe(200);
  return {
    t,
    all,
    push,
    setNow: (x: number) => (now = x),
    rows: () => t.db.select().from(predictions).all(),
  };
}

describe('placar ao vivo', () => {
  it('grava no fechamento ANTES do resultado e confere sozinho; um por horizonte', async () => {
    const { t, all, push, setNow, rows } = await setup();
    expect(rows()).toEqual([]); // o aquecimento nunca grava
    // candle 300 fecha (explícito), com o relógio logo depois
    setNow(all[300]!.time + DAY + 60_000);
    push(all[300]!, true);
    const r1 = rows();
    expect(r1.map((r) => r.horizon).sort((a, b) => a - b)).toEqual([1, 5, 20]);
    for (const r of r1) {
      expect(r.status).toBe('aberta');
      expect(r.candleTime).toBe(all[300]!.time);
      expect(r.createdAt).toBeLessThan(all[300 + r.horizon]!.time + DAY);
      expect(r.p).toBeGreaterThan(0);
      expect(r.p).toBeLessThan(1);
    }
    // candle 301 fecha: confere o de 1 candle e grava outro; os de 5 e 20 continuam abertos
    setNow(all[301]!.time + DAY + 60_000);
    push(all[301]!, true);
    const h1 = rows().filter((r) => r.horizon === 1);
    expect(h1.map((r) => r.status)).toEqual(['conferida', 'aberta']);
    expect(h1[0]).toMatchObject({
      targetTime: all[301]!.time,
      targetClose: all[301]!.close,
      up: all[301]!.close > all[300]!.close,
    });
    expect(
      rows()
        .filter((r) => r.horizon === 5)
        .map((r) => r.status),
    ).toEqual(['aberta']);

    const sb = await t.app.inject({ url: '/api/predict/scoreboard?symbolId=fake:AAA' });
    const e1 = sb.json().entries.find((e: { horizon: number }) => e.horizon === 1);
    expect(e1).toMatchObject({ open: 1, cancelled: 0, board: { n: 1, verdict: 'poucos-casos' } });
    const list = await t.app.inject({ url: '/api/predict/predictions?horizon=1' });
    expect(list.json().predictions[0].detail.situation).toHaveProperty('trend');
  });

  it('camada 2: com treino suficiente grava também a regressão logística, separada no placar', async () => {
    const { t, all, push, setNow, rows } = await setup(700);
    setNow(all[700]!.time + DAY + 60_000);
    push(all[700]!, true);
    const r = rows();
    expect(r.filter((x) => x.method === 'taxa-base')).toHaveLength(3);
    const lg = r.filter((x) => x.method === 'logistica');
    expect(lg.map((x) => x.horizon).sort((a, b) => a - b)).toEqual([1, 5, 20]);
    const d = JSON.parse(lg[0]!.detail);
    expect(d.n).toBeGreaterThanOrEqual(200);
    expect(d.coefficients).toHaveLength(5);
    setNow(all[701]!.time + DAY + 60_000);
    push(all[701]!, true);
    const sb = (await t.app.inject({ url: '/api/predict/scoreboard' })).json();
    const methods = sb.entries
      .filter((e: { horizon: number }) => e.horizon === 1)
      .map((e: { method: string; board: { n: number } }) => [e.method, e.board.n])
      .sort();
    expect(methods).toEqual([
      ['logistica', 1],
      ['taxa-base', 1],
    ]);
  });

  it('não grava quando o candle seguinte já começou ou quando o fechamento chega atrasado', async () => {
    const { all, push, setNow, rows } = await setup();
    // candle 300 em formação e depois o 301 em formação: o 300 fecha por inferência → não prevê
    setNow(all[300]!.time + DAY / 2);
    push(all[300]!, false);
    setNow(all[301]!.time + 60_000);
    push(all[301]!, false);
    expect(rows()).toEqual([]);
    // fechamento do 301 chegando dois candles depois: tarde demais para prever
    setNow(all[301]!.time + 3 * DAY);
    push(all[301]!, true);
    expect(rows()).toEqual([]);
  });

  it('o banco recusa alterar, conferir de novo ou apagar uma previsão', async () => {
    const { t, all, push, setNow, rows } = await setup();
    setNow(all[300]!.time + DAY + 60_000);
    push(all[300]!, true);
    const id = rows()[0]!.id;
    expect(() =>
      t.db.update(predictions).set({ p: 0.99 }).where(eq(predictions.id, id)).run(),
    ).toThrow(/não pode ser alterada/);
    expect(() => t.db.delete(predictions).where(eq(predictions.id, id)).run()).toThrow(
      /não podem ser apagadas/,
    );
    setNow(all[301]!.time + DAY + 60_000);
    push(all[301]!, true);
    const done = rows().find((r) => r.status === 'conferida')!;
    expect(() =>
      t.db.update(predictions).set({ up: !done.up }).where(eq(predictions.id, done.id)).run(),
    ).toThrow(/já conferida/);
  });

  it('depois de reiniciar, confere pelo histórico o que ficou aberto', async () => {
    const { t, all, push, setNow, rows } = await setup();
    setNow(all[300]!.time + DAY + 60_000);
    push(all[300]!, true);
    // servidor "cai"; a fonte segue: 6 candles depois, ele volta e aquece com o histórico novo
    await t.predict.removeTarget(1, 'fake:AAA', '1d').catch(() => undefined);
    t.predict.close();
    t.fake.candles = all.slice(0, 307);
    setNow(all[306]!.time + DAY + 60_000);
    await t.app.inject({
      method: 'POST',
      url: '/api/predict/targets',
      payload: { symbolId: 'fake:AAA', tf: '1d' },
    });
    const byH = (h: number) =>
      rows().find((r) => r.horizon === h && r.candleTime === all[300]!.time);
    expect(byH(1)).toMatchObject({ status: 'conferida', targetTime: all[301]!.time });
    expect(byH(5)).toMatchObject({ status: 'conferida', targetTime: all[305]!.time });
    expect(byH(20)!.status).toBe('aberta');
  });

  it('alvos: limite de escala da fonte e remoção', async () => {
    const { t } = await setup();
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/predict/targets',
      payload: { symbolId: 'fake:AAA', tf: '60m' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/escala/);
    const g = await t.app.inject({ url: '/api/predict/targets' });
    expect(g.json().targets).toHaveLength(1);
    expect(g.json().status[0]).toMatchObject({ symbolId: 'fake:AAA', problem: null });
    const del = await t.app.inject({
      method: 'DELETE',
      url: '/api/predict/targets?symbolId=fake:AAA&tf=1d',
    });
    expect(del.json().targets).toEqual([]);
    expect(t.predict.status()).toEqual([]);
  });
});
