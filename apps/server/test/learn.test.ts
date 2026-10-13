import type { Candle } from '@radar/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { exercises } from '../src/db/schema';
import { LearnService } from '../src/learn/service';
import type { MarketService } from '../src/market/service';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const DAY = 86_400_000;
function series(n: number): Candle[] {
  let a = 42;
  const r = () => (a = (a * 1103515245 + 12345) >>> 0) / 2 ** 32;
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    p = Math.max(5, p * Math.exp(Math.sin(i / 40) * 0.006 + 0.02 * (r() + r() + r() - 1.5)));
    return {
      time: Date.UTC(2020, 0, 1) + i * DAY,
      open: +o.toFixed(2),
      high: +(Math.max(o, p) * (1 + 0.008 * r())).toFixed(2),
      low: +(Math.min(o, p) * (1 - 0.008 * r())).toFixed(2),
      close: +p.toFixed(2),
      volume: 1000,
    };
  });
}

describe('exercícios e trilha', () => {
  it('pergunta sem o futuro, corrige uma vez só e conta na trilha', async () => {
    const t = await testApp();
    close = () => t.app.close();
    const candles = series(800);
    const meta = await t.fake.getMeta('AAA');
    const market = {
      getCandles: async () => ({ candles, meta, status: { state: 'ok' }, lastCandleOpen: false }),
    } as unknown as MarketService;
    let s = 3;
    const learn = new LearnService(
      t.db,
      market,
      true,
      Date.now,
      () => (s = (s * 16807) % 2147483647) / 2147483647,
    );
    await t.app.inject({ url: '/api/prefs' }); // cria o usuário de desenvolvimento
    const userId = 1;

    const v = await learn.create(userId, { level: 2 });
    expect(v.meta.symbol).toBe('Ativo sorteado');
    expect(v.candles.length).toBeLessThanOrEqual(300);
    expect(v.questions.map((q) => q.key)).toEqual(['tem', 'qual', 'gatilho', 'stop']);
    const row = t.db.select().from(exercises).where(eq(exercises.id, v.id)).get()!;
    // o navegador recebeu só até o candle da pergunta; o "depois" ficou no servidor
    expect(JSON.parse(row.candles).length).toBe(v.candles.length + 30);
    const ans = JSON.parse(row.answer) as {
      armed: boolean;
      main: { setup: string; trigger: number; stop: number } | null;
    };
    const right = ans.main
      ? {
          tem: 'sim',
          qual: ans.main.setup,
          gatilho: ans.main.trigger.toFixed(meta.priceDecimals),
          stop: ans.main.stop.toFixed(meta.priceDecimals),
        }
      : { tem: 'nao' };
    const res = learn.answer(userId, v.id, right);
    expect(res.score).toBe(res.total);
    expect(res.future).toHaveLength(30);
    expect(res.meta.symbol).toBe('AAA'); // revelado depois de responder
    // pela rota HTTP, com resposta parcial (só a primeira pergunta)
    const v2 = await learn.create(userId, { level: 1 });
    const http2 = await t.app.inject({
      method: 'POST',
      url: `/api/exercises/${v2.id}/answer`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ answers: { tem: 'nao' } }),
    });
    expect(http2.statusCode).toBe(200);
    expect(http2.json().graded[0].key).toBe('tem');
    // segunda resposta (errada) não muda a nota
    expect(learn.answer(userId, v.id, { tem: ans.armed ? 'nao' : 'sim' }).score).toBe(res.score);
    expect(learn.stats(userId)[1]).toMatchObject({ level: 2, answered: 1, perfect: 1 });
    expect(learn.stats(userId)[0]?.answered).toBe(1);

    // trilha: leitura marcada nas preferências + exercício perfeito
    await t.app.inject({
      method: 'PUT',
      url: '/api/prefs',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ trailRead: ['candles', 'primitivas-price-action'] }),
    });
    const tr = learn.trail(userId);
    const m = tr.modules.find((x) => x.id === 'candles')!;
    expect(m.read.every((x) => x.done)).toBe(true);
    expect(m.exercises).toEqual({ done: 1, need: 5 });
    expect(m.complete).toBe(false);
    const http = await t.app.inject({ url: '/api/trail' });
    expect(http.statusCode).toBe(200);
  });

  it('sem histórico suficiente: explica (nunca inventa)', async () => {
    const t = await testApp();
    close = () => t.app.close();
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/exercises',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ level: 1 }),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/Não consegui montar um exercício/);
  });
});
