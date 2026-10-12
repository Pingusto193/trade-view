import type { Drawing, ServerMessage } from '@radar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const hline = (id: string, price = 100): Omit<Drawing, 'id'> & { id: string } => ({
  id,
  symbolId: 'binance:BTCUSDT',
  tf: null,
  locked: false,
  hidden: false,
  style: { color: '#ffcc00', lineWidth: 2, dashed: false },
  data: { kind: 'hline', points: [{ time: 1_700_000_000_000, price }] },
});

async function app() {
  const t = await testApp();
  close = () => t.app.close();
  const req = (
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    body?: unknown,
    client?: string,
  ) =>
    t.app.inject({
      method,
      url,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(client ? { 'x-radar-client': client } : {}),
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
  return { t, req };
}

describe('desenhos', () => {
  it('cria, lista, altera e apaga (soft delete) com revisão crescente', async () => {
    const { req } = await app();
    const a = (await req('PUT', '/api/drawings/desenho-0001', hline('desenho-0001'))).json();
    expect(a.rev).toBe(1);
    const b = (
      await req('PUT', '/api/drawings/desenho-0001', {
        ...hline('desenho-0001', 150),
        locked: true,
      })
    ).json();
    expect(b.rev).toBe(2);
    const list = (await req('GET', '/api/drawings?symbolId=binance:BTCUSDT')).json().drawings;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      locked: true,
      data: { kind: 'hline', points: [{ price: 150 }] },
    });
    expect((await req('DELETE', '/api/drawings/desenho-0001')).statusCode).toBe(200);
    expect(
      (await req('GET', '/api/drawings?symbolId=binance:BTCUSDT')).json().drawings,
    ).toHaveLength(0);
  });

  it('dados inválidos são recusados', async () => {
    const { req } = await app();
    const bad = {
      ...hline('desenho-0002'),
      data: { kind: 'trend', points: [{ time: 1, price: 1 }] },
    };
    expect((await req('PUT', '/api/drawings/desenho-0002', bad)).statusCode).toBe(400);
  });

  it('desenho feito em um aparelho avisa o outro pelo WebSocket (critério da Fase 2)', async () => {
    const { t, req } = await app();
    await t.app.ready();
    const phone = await t.app.injectWS('/ws');
    const msgs: ServerMessage[] = [];
    phone.on('message', (d: Buffer) => msgs.push(JSON.parse(d.toString()) as ServerMessage));
    await req('PUT', '/api/drawings/desenho-0003', hline('desenho-0003'), 'pc-123');
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs).toContainEqual({
      type: 'sync',
      topic: 'drawings',
      symbolId: 'binance:BTCUSDT',
      origin: 'pc-123',
    });
    phone.terminate();
  });
});

describe('watchlists', () => {
  it('cria a lista padrão no primeiro acesso e permite editar', async () => {
    const { req } = await app();
    const first = (await req('GET', '/api/watchlists')).json().watchlists;
    expect(first).toHaveLength(1);
    expect(first[0].items).toContain('binance:BTCUSDT');
    const id = first[0].id;
    await req('PUT', `/api/watchlists/${id}`, {
      name: 'Swing B3',
      items: ['brapi:PETR4', 'brapi:PETR4', 'brapi:WEGE3'],
    });
    const after = (await req('GET', '/api/watchlists')).json().watchlists;
    expect(after[0]).toEqual({ id, name: 'Swing B3', items: ['brapi:PETR4', 'brapi:WEGE3'] });
    const created = (await req('POST', '/api/watchlists', { name: 'Cripto' })).json();
    expect((await req('GET', '/api/watchlists')).json().watchlists).toHaveLength(2);
    await req('DELETE', `/api/watchlists/${created.id}`);
    expect((await req('GET', '/api/watchlists')).json().watchlists).toHaveLength(1);
  });
});

describe('presets e preferências', () => {
  it('salva preset personalizado; presets prontos são protegidos', async () => {
    const { req } = await app();
    const preset = {
      name: 'Só médias',
      indicators: [
        {
          kind: 'ema',
          id: 'm9',
          enabled: true,
          period: 9,
          color: '#fff',
          lineWidth: 2,
          dashed: false,
        },
      ],
    };
    expect((await req('PUT', '/api/presets/meu-preset', preset)).statusCode).toBe(200);
    expect((await req('GET', '/api/presets')).json().presets[0]).toMatchObject({
      id: 'meu-preset',
      name: 'Só médias',
      builtIn: false,
    });
    expect((await req('PUT', '/api/presets/padrao-do-canal', preset)).statusCode).toBe(400);
    expect(
      (
        await req('PUT', '/api/presets/outro', {
          name: 'x',
          indicators: [{ kind: 'ema', period: -1 }],
        })
      ).statusCode,
    ).toBe(400);
  });

  it('preferências começam com os padrões e aceitam atualização parcial', async () => {
    const { req } = await app();
    expect((await req('GET', '/api/prefs')).json()).toMatchObject({
      capital: 10_000,
      riskPct: 1,
      chartType: 'candles',
    });
    const p = (await req('PUT', '/api/prefs', { riskPct: 1.5 })).json();
    expect(p).toMatchObject({ riskPct: 1.5, capital: 10_000 });
    expect((await req('PUT', '/api/prefs', { riskPct: 50 })).statusCode).toBe(400);
  });
});
