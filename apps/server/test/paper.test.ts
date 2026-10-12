import type { Candle, PaperAccount, PaperOrder, PaperPosition } from '@radar/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeSenders, testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const T0 = Date.UTC(2026, 9, 12, 14, 0);
const M = 60_000;

async function setup(fx?: FakeSenders) {
  const t = await testApp({ now: () => Date.now(), ...(fx ? { senders: fx } : {}) });
  close = () => t.app.close();
  // histórico de 1 minuto terminando em 100,00 (a fonte de teste é 24/7, em dólar)
  t.fake.candles = Array.from({ length: 30 }, (_, i) => ({
    time: T0 + i * M,
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 10,
  }));
  const req = async (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, body?: unknown) => {
    const r = await t.app.inject({
      method,
      url,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    return { status: r.statusCode, body: r.json() };
  };
  let bar = 30;
  /** Empurra um candle de 1 minuto pela fonte ao vivo. */
  const tick = (o: number, h: number, l: number, c: number, closed = false, newBar = true) => {
    if (newBar) bar++;
    const candle: Candle = { time: T0 + bar * M, open: o, high: h, low: l, close: c, volume: 1 };
    for (const handler of t.fake.handlers) handler.onCandle({ candle, closed });
  };
  const acc = (await req('POST', '/api/paper/accounts', { name: 'Teste', initialBalance: 50_000 }))
    .body as PaperAccount;
  const state = async () =>
    (await req('GET', `/api/paper/accounts/${acc.id}/state`)).body as {
      account: PaperAccount;
      equity: number;
      positions: PaperPosition[];
      orders: PaperOrder[];
    };
  return { t, req, tick, acc, state };
}

const order = (accountId: string, over: Record<string, unknown> = {}) => ({
  accountId,
  symbolId: 'fake:AAA',
  side: 'buy',
  type: 'market',
  qty: 10,
  ...over,
});

describe('Modo Treino (preço real da fonte, dinheiro fictício)', () => {
  it('saldo inicial editável; ativo em dólar exige cotação (ao vivo ou manual)', async () => {
    const { req, acc, state } = await setup();
    expect(acc.cash).toBe(50_000);
    expect((await state()).equity).toBe(50_000);
    // sem cotação do dólar ao vivo (fonte de teste) e sem cotação manual: recusa com explicação
    const r = await req('POST', '/api/paper/orders', order(acc.id));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/cotação do dólar/);
  });

  it('compra a mercado executa no último preço + spread e taxa; stop executa sozinho', async () => {
    const { req, tick, acc, state } = await setup();
    await req('PUT', `/api/paper/accounts/${acc.id}`, { fxManual: 5 });
    const o = await req(
      'POST',
      '/api/paper/orders',
      order(acc.id, { stopLoss: 95, takeProfit: 110 }),
    );
    expect(o.status).toBe(200);
    expect(o.body.status).toBe('filled');
    // cripto: meio spread de 0,02% → 100,01; taxa 0,1%
    expect(o.body.fillPrice).toBe(100.01);
    let s = await state();
    const cost = (100.01 * 10 + 100.01 * 10 * 0.001) * 5;
    expect(s.account.cash).toBeCloseTo(50_000 - cost, 2);
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0]).toMatchObject({ qty: 10, stop: 95, target: 110, initialStop: 95 });

    // preço real cai e atravessa o stop
    tick(99, 99.2, 94.5, 94.8);
    await vi.waitFor(async () => expect((await state()).positions).toHaveLength(0));
    const j = (await req('GET', `/api/paper/accounts/${acc.id}/journal`)).body;
    expect(j.trades).toHaveLength(1);
    const tr = j.trades[0] as PaperPosition;
    // saída 95 − meio spread (0,0095) → 94,99
    expect(tr.realizedBrl).toBeLessThan(-250);
    expect(tr.r).toBeLessThan(-1); // custos pioram o R (o treino não pode parecer melhor)
    expect(tr.r).toBeGreaterThan(-1.1);
    expect(j.stats).toMatchObject({ trades: 1, wins: 0, withoutStop: 0 });
    s = await state();
    expect(s.equity).toBe(s.account.cash);
  });

  it('stop com gap executa na abertura (pior preço)', async () => {
    const { req, tick, acc } = await setup();
    await req('PUT', `/api/paper/accounts/${acc.id}`, { fxManual: 5 });
    await req('POST', '/api/paper/orders', order(acc.id, { stopLoss: 95 }));
    tick(90, 91, 89, 90.5); // abre em 90, muito abaixo do stop
    await vi.waitFor(async () => {
      const ev = (await req('GET', `/api/paper/accounts/${acc.id}/state`)).body.events;
      expect(ev.find((e: { kind: string }) => e.kind === 'saida')?.detail).toMatch(/gap/);
    });
  });

  it('ordem limitada só executa se o preço passar além do limite', async () => {
    const { req, tick, acc, state } = await setup();
    await req('PUT', `/api/paper/accounts/${acc.id}`, { fxManual: 5 });
    const o = await req('POST', '/api/paper/orders', order(acc.id, { type: 'limit', price: 98 }));
    expect(o.body.status).toBe('pending');
    tick(99, 99.5, 98, 98.5); // só tocou
    await new Promise((r) => setTimeout(r, 20));
    expect((await state()).orders).toHaveLength(1);
    tick(98.5, 98.6, 97.9, 98.2); // passou além
    await vi.waitFor(async () => expect((await state()).positions).toHaveLength(1));
    expect((await state()).positions[0]!.avgPrice).toBe(98);
  });

  it('stop só anda a favor; afastar exige confirmação e fica no diário', async () => {
    const { req, acc, state } = await setup();
    await req('PUT', `/api/paper/accounts/${acc.id}`, { fxManual: 5 });
    await req('POST', '/api/paper/orders', order(acc.id, { stopLoss: 95 }));
    const p = (await state()).positions[0]!;
    expect((await req('PUT', `/api/paper/positions/${p.id}`, { stop: 97 })).status).toBe(200);
    const back = await req('PUT', `/api/paper/positions/${p.id}`, { stop: 90 });
    expect(back.status).toBe(409);
    const ok = await req('PUT', `/api/paper/positions/${p.id}`, {
      stop: 90,
      confirmBackward: true,
    });
    expect(ok.status).toBe(200);
    const ev = (await req('GET', `/api/paper/accounts/${acc.id}/state`)).body.events as {
      kind: string;
    }[];
    expect(ev.map((e) => e.kind)).toContain('stop-movido-para-tras');
    // stop acima do preço atual numa compra: recusado
    expect((await req('PUT', `/api/paper/positions/${p.id}`, { stop: 101 })).status).toBe(400);
  });

  it('sem venda a descoberto; saldo insuficiente é recusado', async () => {
    const { req, acc } = await setup();
    await req('PUT', `/api/paper/accounts/${acc.id}`, { fxManual: 5 });
    const short = await req('POST', '/api/paper/orders', order(acc.id, { side: 'sell' }));
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/descoberto/);
    const big = await req('POST', '/api/paper/orders', order(acc.id, { qty: 1_000 }));
    expect(big.body).toMatchObject({ status: 'rejected' });
    expect(big.body.reason).toMatch(/saldo insuficiente/);
  });

  it('venda parcial e total pela boleta; reinício guarda o histórico', async () => {
    const { req, acc, state } = await setup();
    await req('PUT', `/api/paper/accounts/${acc.id}`, { fxManual: 5 });
    await req('POST', '/api/paper/orders', order(acc.id, { qty: 10 }));
    await req('POST', '/api/paper/orders', order(acc.id, { side: 'sell', qty: 4 }));
    expect((await state()).positions[0]!.qty).toBe(6);
    await req('POST', '/api/paper/orders', order(acc.id, { side: 'sell', qty: 6 }));
    expect((await state()).positions).toHaveLength(0);
    let j = (await req('GET', `/api/paper/accounts/${acc.id}/journal`)).body;
    expect(j.trades).toHaveLength(1);
    expect(j.stats.withoutStop).toBe(1);
    expect(j.trades[0].r).toBeNull(); // sem stop, R não existe

    const r = await req('POST', `/api/paper/accounts/${acc.id}/reset`, { initialBalance: 20_000 });
    expect(r.body).toMatchObject({ cash: 20_000, initialBalance: 20_000, generation: 2 });
    j = (await req('GET', `/api/paper/accounts/${acc.id}/journal`)).body;
    expect(j.trades).toHaveLength(0);
    j = (await req('GET', `/api/paper/accounts/${acc.id}/journal?all=1`)).body;
    expect(j.trades).toHaveLength(1);
  });

  it('stop executado pelo servidor avisa no aparelho (app fechado)', async () => {
    const fx = new FakeSenders();
    const { req, tick, acc } = await setup(fx);
    await req('POST', '/api/notify/push', {
      endpoint: 'https://push.exemplo.com/x',
      keys: { p256dh: 'BOr5x3ZpY7m0kQ9wA1b2c3d4e5f6', auth: 'qwertyuiopas' },
      label: 'iPhone',
    });
    await req('PUT', `/api/paper/accounts/${acc.id}`, { fxManual: 5 });
    await req('POST', '/api/paper/orders', order(acc.id, { stopLoss: 95 }));
    expect(fx.push).toHaveLength(0); // execução pedida na tela não gera aviso
    tick(99, 99.2, 94.5, 94.8);
    await vi.waitFor(() => expect(fx.push).toHaveLength(1));
    const msg = JSON.parse(fx.push[0]!.payload);
    expect(msg.title).toBe('Treino · AAA');
    expect(msg.body).toMatch(/Stop executado a 94,99.*Dinheiro fictício/);
  });
});
