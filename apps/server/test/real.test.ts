import type { RealTrade } from '@radar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { RealJournal } from '../src/real/service';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const NOW = Date.UTC(2026, 9, 13, 18);
const H = 3_600_000;

async function setup() {
  const t = await testApp({ now: () => NOW });
  close = () => t.app.close();
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) => {
    const res = await t.app.inject({
      method,
      url,
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }
        : {}),
    });
    return { status: res.statusCode, body: res.json() as unknown };
  };
  return call;
}

const petr = {
  symbol: 'petr4',
  symbolId: 'brapi:PETR4',
  market: 'b3-acao',
  side: 'long',
  currency: 'BRL',
  pointValue: 1,
  initialStop: 36,
  target: 42,
  entry: { time: NOW - 50 * H, kind: 'entrada', qty: 200, price: 38, feesBrl: 4, fx: 1 },
  note: 'Recuo à MME21',
};

describe('diário real', () => {
  it('registra, parcial, stop para trás exige confirmação, breakeven, encerra; IR e estatísticas', async () => {
    const call = await setup();
    const c = await call('POST', '/api/real/trades', petr);
    expect(c.status).toBe(200);
    const tr = c.body as RealTrade;
    expect(tr).toMatchObject({ symbol: 'PETR4', status: 'aberto', openQty: 200, avgEntry: 38 });
    expect(tr.events.map((e) => e.kind)).toEqual(['entrada']);

    // parcial no alvo intermediário
    const p = await call('POST', `/api/real/trades/${tr.id}/fills`, {
      time: NOW - 26 * H,
      kind: 'saida',
      qty: 100,
      price: 40,
      feesBrl: 2,
    });
    expect((p.body as RealTrade).events.at(-1)?.detail).toBe('Saída parcial');
    expect((p.body as RealTrade).realizedBrl).toBe(196); // 200 − 2 − 100 × 0,02

    // afastar o stop sem confirmar: recusado
    const back = await call('PATCH', `/api/real/trades/${tr.id}`, { stop: 35 });
    expect(back.status).toBe(409);
    const ok = await call('PATCH', `/api/real/trades/${tr.id}`, {
      stop: 35,
      confirmMovedBack: true,
    });
    expect((ok.body as RealTrade).stopMovedBack).toBe(true);
    // stop no preço médio = breakeven
    const be = await call('PATCH', `/api/real/trades/${tr.id}`, { stop: 38 });
    expect((be.body as RealTrade).events.at(-1)?.detail).toContain('breakeven');

    const fim = await call('POST', `/api/real/trades/${tr.id}/fills`, {
      time: NOW - 2 * H,
      kind: 'saida',
      qty: 100,
      price: 38,
      feesBrl: 2,
    });
    const closed = fim.body as RealTrade;
    expect(closed.status).toBe('fechado');
    expect(closed.realizedBrl).toBe(192); // 196 + (0 − 2 − 2)
    expect(closed.initialRiskBrl).toBe(400); // (38 − 36) × 200
    expect(closed.r).toBe(0.48);

    // depois de fechado, não mexe no stop
    expect((await call('PATCH', `/api/real/trades/${tr.id}`, { stop: 39 })).status).toBe(400);

    const j = (await call('GET', '/api/real/journal')).body as RealJournal;
    expect(j.stats).toMatchObject({ trades: 1, wins: 1, stopMovedBack: 1, withPlan: 0 });
    expect(j.tax).toHaveLength(1); // outubro: vendas abaixo de R$ 20 mil → isento
    expect(j.tax[0]?.darf).toBe(0);
  });

  it('recusa stop do lado errado, saída maior que a posição, data no futuro e trade de outro usuário', async () => {
    const call = await setup();
    expect((await call('POST', '/api/real/trades', { ...petr, initialStop: 39 })).status).toBe(400);
    expect(
      (
        await call('POST', '/api/real/trades', {
          ...petr,
          side: 'short',
          initialStop: 40,
          target: 30,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('POST', '/api/real/trades', {
          ...petr,
          entry: { ...petr.entry, time: NOW + 2 * H },
        })
      ).status,
    ).toBe(400);
    const tr = (await call('POST', '/api/real/trades', petr)).body as RealTrade;
    const big = await call('POST', `/api/real/trades/${tr.id}/fills`, {
      time: NOW - H,
      kind: 'saida',
      qty: 300,
      price: 40,
    });
    expect(big.status).toBe(400);
    expect((big.body as { error: string }).error).toMatch(/maior que a quantidade aberta/);
    // apagar a única entrada não pode
    const only = tr.fills[0]!.id;
    expect((await call('DELETE', `/api/real/trades/${tr.id}/fills/${only}`)).status).toBe(400);
    expect((await call('DELETE', `/api/real/trades/${tr.id}`)).status).toBe(200);
    expect((await call('PATCH', `/api/real/trades/${tr.id}`, { note: 'x' })).status).toBe(404);
  });

  it('mini-índice em day trade entra no IR como day trade', async () => {
    const call = await setup();
    const tr = (
      await call('POST', '/api/real/trades', {
        symbol: 'WINZ26',
        market: 'b3-win',
        side: 'long',
        currency: 'BRL',
        pointValue: 0.2,
        initialStop: 129_800,
        target: null,
        entry: { time: NOW - 5 * H, kind: 'entrada', qty: 5, price: 130_000, feesBrl: 2.5 },
      })
    ).body as RealTrade;
    await call('POST', `/api/real/trades/${tr.id}/fills`, {
      time: NOW - 4 * H,
      kind: 'saida',
      qty: 5,
      price: 131_000,
      feesBrl: 2.5,
    });
    const j = (await call('GET', '/api/real/journal')).body as RealJournal;
    expect(j.trades[0]?.realizedBrl).toBe(995); // 1000 × 0,2 × 5 − 5
    // day trade: 20% sobre 995, menos o IRRF de 1% do lucro
    expect(j.tax[0]?.darf).toBeGreaterThan(180);
    expect(j.tax[0]?.darf).toBeLessThan(200);
  });
});
