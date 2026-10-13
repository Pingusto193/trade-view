import type { Candle } from '@radar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReplayView } from '../src/replay/service';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const DAY = 86_400_000;
const T0 = Date.UTC(2020, 0, 1);

/** Passeio aleatório determinístico. */
function walk(n: number): Candle[] {
  let a = 777;
  const r = () => (a = (a * 1103515245 + 12345) >>> 0) / 2 ** 32;
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    p = p * Math.exp(0.03 * (r() + r() + r() - 1.5));
    return {
      time: T0 + i * DAY,
      open: o,
      high: Math.max(o, p) * (1 + 0.01 * r()),
      low: Math.min(o, p) * (1 - 0.01 * r()),
      close: p,
      volume: 1000,
    };
  });
}

async function setup() {
  const t = await testApp({ now: () => T0 + 2000 * DAY });
  close = () => t.app.close();
  t.fake.candles = walk(600);
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) => {
    const res = await t.app.inject({
      method,
      url,
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }
        : {}),
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  };
  return { t, call };
}

describe('replay', () => {
  it('só entrega candles revelados; ordem executa no candle seguinte; encerra com feedback', async () => {
    const { t, call } = await setup();
    const all = t.fake.candles;
    const start = all[400]!.time;
    const c = await call('POST', '/api/replay/sessions', {
      mode: 'escolha',
      symbolId: 'fake:AAA',
      tf: '1d',
      date: start,
      capital: 100_000,
      fxManual: 5,
    });
    expect(c.status).toBe(200);
    const v = c.body as unknown as ReplayView;
    expect(v.candles).toHaveLength(250); // aquecimento
    expect(v.candles.at(-1)!.time).toBe(all[399]!.time);
    expect(v.candles.every((x) => x.time < start)).toBe(true); // o futuro não sai do servidor
    expect(v.total).toBe(450);
    expect(v.book.fx).toBe(5);

    const last = v.candles.at(-1)!.close;
    const o = await call('POST', `/api/replay/sessions/${v.id}/orders`, {
      side: 'buy',
      type: 'market',
      qty: 10,
      stop: last * 0.9,
      target: last * 1.2,
    });
    expect(o.status).toBe(200);
    const a = await call('POST', `/api/replay/sessions/${v.id}/advance`, { n: 1 });
    const av = a.body as unknown as ReplayView & { revealed: Candle[] };
    expect(av.revealed).toHaveLength(1);
    expect(av.revealed[0]!.time).toBe(start);
    // a mercado = abertura do candle seguinte + derrapagem (custos padrão de cripto)
    expect(av.book.position?.avgPrice).toBeGreaterThanOrEqual(all[400]!.open);
    expect(av.book.position?.openedAt).toBe(start);

    // afastar o stop sem confirmar: 409
    const back = await call('PATCH', `/api/replay/sessions/${v.id}/position`, { stop: last * 0.8 });
    expect(back.status).toBe(409);

    const end = await call('POST', `/api/replay/sessions/${v.id}/end`);
    const ev = end.body as unknown as ReplayView;
    expect(ev.status).toBe('encerrada');
    expect(ev.book.position).toBeNull();
    const tr = ev.book.trades[0]!;
    expect(tr.exitKind).toBe('manual');
    const fb = await call('GET', `/api/replay/sessions/${v.id}/trades/${tr.id}/feedback`);
    expect(fb.status).toBe(200);
    expect((fb.body.items as unknown[]).length).toBeGreaterThan(0);

    // encerrada: não avança mais
    expect((await call('POST', `/api/replay/sessions/${v.id}/advance`, { n: 1 })).status).toBe(400);
    const j = await call('GET', '/api/replay/journal');
    expect(j.body.trades).toBe(1);
    const list = await call('GET', '/api/replay/sessions');
    expect((list.body.sessions as { label: string }[])[0]?.label).toBe('AAA');
  });

  it('fim do trecho encerra sozinho; data sem aquecimento suficiente é recusada', async () => {
    const { t, call } = await setup();
    const tooEarly = await call('POST', '/api/replay/sessions', {
      mode: 'escolha',
      symbolId: 'fake:AAA',
      date: t.fake.candles[100]!.time,
      fxManual: 5,
    });
    expect(tooEarly.status).toBe(400);
    expect(String(tooEarly.body.error)).toMatch(/250 para os indicadores/);
    const late = await call('POST', '/api/replay/sessions', {
      mode: 'escolha',
      symbolId: 'fake:AAA',
      date: t.fake.candles[590]!.time,
      fxManual: 5,
    });
    expect(String(late.body.error)).toMatch(/menos de 60 candles/);

    const v = (
      await call('POST', '/api/replay/sessions', {
        mode: 'escolha',
        symbolId: 'fake:AAA',
        date: t.fake.candles[520]!.time,
        fxManual: 5,
      })
    ).body as unknown as ReplayView;
    expect(v.total - v.cursor).toBe(80);
    const a = await call('POST', `/api/replay/sessions/${v.id}/advance`, { n: 50 });
    expect((a.body as unknown as ReplayView).cursor).toBe(v.cursor + 50); // máximo por vez
    const b = await call('POST', `/api/replay/sessions/${v.id}/advance`, { n: 50 });
    expect((b.body as unknown as ReplayView).status).toBe('encerrada');
  });

  it('sorteio: sem ativos com histórico, explica (nunca inventa)', async () => {
    const { call } = await setup();
    const r = await call('POST', '/api/replay/sessions', { mode: 'sorteio', fxManual: 5 });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/Não achei histórico suficiente/);
  });
});
