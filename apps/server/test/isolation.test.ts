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
  });
});
