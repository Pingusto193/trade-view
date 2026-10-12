import type { CandlesResponse, ServerMessage } from '@radar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { DAY, series, testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('API de mercado', () => {
  it('health responde', async () => {
    const t = await testApp();
    close = () => t.app.close();
    const r = await t.app.inject({ url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, name: 'Radar' });
  });

  it('busca unificada e lista de fontes', async () => {
    const t = await testApp();
    close = () => t.app.close();
    expect((await t.app.inject({ url: '/api/symbols/search?q=AAA' })).json().results).toHaveLength(
      1,
    );
    expect((await t.app.inject({ url: '/api/sources' })).json().sources[0]).toMatchObject({
      id: 'fake',
      configured: true,
    });
  });

  it('candles: busca na fonte, grava no cache e informa candle em formação', async () => {
    const now = 9 * DAY + 3600_000; // dia 9, 01:00 UTC
    const t = await testApp({ now });
    close = () => t.app.close();
    t.fake.candles = series(10);
    const r = await t.app.inject({ url: '/api/candles?id=fake:AAA&tf=1d&limit=5' });
    const body = r.json<CandlesResponse>();
    expect(r.statusCode).toBe(200);
    expect(body.candles).toHaveLength(5);
    expect(body.status.state).toBe('ok');
    expect(body.lastCandleOpen).toBe(true); // o candle do dia 9 ainda está em formação
    expect(t.store.load('fake:AAA', '1d')).toHaveLength(5);
  });

  it('se a fonte falhar, devolve o cache com o erro e a data do último dado válido', async () => {
    const t = await testApp({ now: 20 * DAY });
    close = () => t.app.close();
    t.fake.candles = series(10);
    await t.app.inject({ url: '/api/candles?id=fake:AAA&tf=1d' });
    t.fake.fail = 'fonte fora do ar';
    const body = (
      await t.app.inject({ url: '/api/candles?id=fake:AAA&tf=1d' })
    ).json<CandlesResponse>();
    expect(body.candles).toHaveLength(10);
    expect(body.status.state).toBe('error');
    expect(body.status.message).toContain('fonte fora do ar');
    expect(body.status.lastValidAt).toBe(20 * DAY);
  });

  it('sem cache e com fonte fora: lista vazia e erro (nunca inventa dados)', async () => {
    const t = await testApp();
    close = () => t.app.close();
    t.fake.fail = 'falhou';
    const body = (
      await t.app.inject({ url: '/api/candles?id=fake:AAA&tf=1d' })
    ).json<CandlesResponse>();
    expect(body.candles).toEqual([]);
    expect(body.status.state).toBe('error');
  });

  it('parâmetros inválidos → 400', async () => {
    const t = await testApp();
    close = () => t.app.close();
    const r = await t.app.inject({ url: '/api/candles?id=fake:AAA&tf=2h' });
    expect(r.statusCode).toBe(400);
  });
});

describe('WebSocket de tempo real', () => {
  it('assina, recebe status e candles, e grava candles fechados', async () => {
    const t = await testApp();
    close = () => t.app.close();
    await t.app.ready();
    const ws = await t.app.injectWS('/ws');
    const msgs: ServerMessage[] = [];
    ws.on('message', (d: Buffer) => msgs.push(JSON.parse(d.toString()) as ServerMessage));
    ws.send(JSON.stringify({ type: 'subscribe', id: 'fake:AAA', tf: '1m' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs[0]).toMatchObject({ type: 'status', status: { state: 'ok' } });

    const h = t.fake.handlers[0];
    expect(h).toBeDefined();
    const c = { time: 60_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 };
    h?.onCandle({ candle: c, closed: false });
    h?.onCandle({ candle: { ...c, close: 1.7 }, closed: true });
    await new Promise((r) => setTimeout(r, 50));
    const candles = msgs.filter((m) => m.type === 'candle');
    expect(candles).toHaveLength(2);
    expect(t.store.load('fake:AAA', '1m')).toEqual([{ ...c, close: 1.7 }]);

    // mensagem inválida não derruba a conexão
    ws.send('{"type":"nada"}');
    ws.send(JSON.stringify({ type: 'ping' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.some((m) => m.type === 'error')).toBe(true);
    expect(msgs.at(-1)).toEqual({ type: 'pong' });
    ws.terminate();
  });

  it('dois navegadores no mesmo ativo usam uma única assinatura na fonte', async () => {
    const t = await testApp();
    close = () => t.app.close();
    await t.app.ready();
    const a = await t.app.injectWS('/ws');
    const b = await t.app.injectWS('/ws');
    const sub = JSON.stringify({ type: 'subscribe', id: 'fake:AAA', tf: '1d' });
    a.send(sub);
    b.send(sub);
    await new Promise((r) => setTimeout(r, 50));
    expect(t.fake.handlers).toHaveLength(1);
    a.terminate();
    b.terminate();
  });
});

describe('cotações para listas', () => {
  it('devolve último preço e variação; erro por ativo não derruba os outros', async () => {
    const t = await testApp({ now: 9 * DAY + 3600_000 });
    close = () => t.app.close();
    t.fake.candles = series(10);
    const r = (await t.app.inject({ url: '/api/quotes?ids=fake:AAA,naoexiste:XYZ' })).json();
    expect(r.quotes['fake:AAA']).toMatchObject({ last: 109.5, symbol: 'AAA' });
    expect(r.quotes['fake:AAA'].changePct).toBeCloseTo((109.5 / 108.5 - 1) * 100);
    expect(r.quotes['naoexiste:XYZ'].error).toMatch(/fonte desconhecida/);
  });
});
