import { afterEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('isolamento entre usuários', () => {
  it('um usuário não lê nem altera desenhos de outro', async () => {
    const t = await testApp({ auth: true });
    close = () => t.app.close();
    const post = (url: string, body: unknown, cookie?: string) =>
      t.app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        payload: JSON.stringify(body),
      });
    const ck = (r: { cookies: { name: string; value: string }[] }) =>
      `radar_sid=${r.cookies.find((c) => c.name === 'radar_sid')?.value}`;
    const a = ck(
      await post('/api/auth/register', { email: 'a@a.com', password: 'senha-longa-aaa' }),
    );
    const inv = (await post('/api/auth/invites', {}, a)).json();
    const b = ck(
      await post('/api/auth/register', {
        email: 'b@b.com',
        password: 'senha-longa-bbb',
        invite: new URL(inv.url).searchParams.get('token'),
      }),
    );
    const d = {
      symbolId: 'binance:BTCUSDT',
      tf: null,
      data: { kind: 'hline', points: [{ time: 1, price: 1 }] },
    };
    const put = (cookie: string) =>
      t.app.inject({
        method: 'PUT',
        url: '/api/drawings/desenho-aaaa',
        headers: { 'content-type': 'application/json', cookie },
        payload: JSON.stringify(d),
      });
    expect((await put(a)).statusCode).toBe(200);
    expect((await put(b)).statusCode).toBe(404);
    const listB = await t.app.inject({
      url: '/api/drawings?symbolId=binance:BTCUSDT',
      headers: { cookie: b },
    });
    expect(listB.json().drawings).toEqual([]);
    expect(
      (
        await t.app.inject({
          method: 'DELETE',
          url: '/api/drawings/desenho-aaaa',
          headers: { cookie: b },
        })
      ).statusCode,
    ).toBe(404);

    // alertas e histórico de disparos também são isolados
    const alert = {
      symbolId: 'fake:AAA',
      tf: '1d',
      condition: { kind: 'price', level: 10, direction: 'up' },
    };
    const created = (await post('/api/alerts', alert, a)).json();
    expect(created.id).toBeTruthy();
    const as = (cookie: string, method: 'GET' | 'PUT' | 'DELETE', url: string, body?: unknown) =>
      t.app.inject({
        method,
        url,
        headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { payload: JSON.stringify(body) } : {}),
      });
    expect((await as(b, 'GET', '/api/alerts')).json().alerts).toEqual([]);
    expect((await as(b, 'PUT', `/api/alerts/${created.id}`, alert)).statusCode).toBe(404);
    expect((await as(b, 'DELETE', `/api/alerts/${created.id}`)).statusCode).toBe(404);
    expect((await as(a, 'GET', '/api/alerts')).json().alerts).toHaveLength(1);
    // sem login: nada
    expect((await t.app.inject({ url: '/api/alerts' })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/api/notify/settings' })).statusCode).toBe(401);
  });
});
