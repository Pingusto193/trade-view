import type { TradeFeedback } from '@radar/core';
import type { Candle, PaperAccount, PaperPosition } from '@radar/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY, testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const HOUR = 3_600_000;
const D0 = Date.UTC(2026, 0, 1);

/**
 * Diário feito à mão (o mesmo do teste do core): alta de 70 candles; o candle 70 arma o Setup 9.2
 * (gatilho 170,21, stop 167,49), o 71 rompe e a alta segue até o alvo de 2R do setup (175,65), no 75.
 */
function fixture92(): Candle[] {
  const out: Candle[] = [];
  const add = (o: number, h: number, l: number, c: number) =>
    out.push({ time: D0 + out.length * DAY, open: o, high: h, low: l, close: c, volume: 1000 });
  const to = (c: number, range: number) => {
    const o = out.length ? out[out.length - 1]!.close : c;
    add(o, Math.max(o, c) + range / 2, Math.min(o, c) - range / 2, c);
  };
  for (let k = 0; k < 70; k++) to((out.at(-1)?.close ?? 100) + 1, 1);
  const ref = out.at(-1)!;
  add(ref.close, ref.close + 0.2, ref.low - 1, ref.low - 0.5); // 70: arma
  add(out.at(-1)!.close, 171.21, 167.8, 171.01); // 71: rompe
  for (let k = 0; k < 12; k++) to(out.at(-1)!.close + 1.2, 0.8);
  return out;
}

const PLAN = {
  setup: 's92',
  tfContext: '1w',
  tfSetup: '1d',
  tfTrigger: '60m',
  aligned: true,
  exitCriterion: 'alvo',
  reason: 'Fechou abaixo da mínima anterior com a MME9 subindo',
  checks: { ego: true, revanche: true, lucro: true, demais: true, plano: true },
  warnings: [],
  screenshot: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',
};

type FeedbackBody = TradeFeedback & { source: string | null; positionId: string };

async function setup() {
  let clock = D0 + 71 * DAY + 12 * HOUR; // no meio do candle 71
  const t = await testApp({ now: () => clock });
  close = () => t.app.close();
  const all = fixture92();
  t.fake.candles = all.slice(0, 72);
  const req = async (method: 'GET' | 'PUT' | 'POST', url: string, body?: unknown) => {
    const r = await t.app.inject({
      method,
      url,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    return { status: r.statusCode, body: r.json() };
  };
  const acc = (await req('POST', '/api/paper/accounts', { name: 'Teste', initialBalance: 50_000 }))
    .body as PaperAccount;
  await req('PUT', `/api/paper/accounts/${acc.id}`, { fxManual: 5 });
  const state = async () =>
    (await req('GET', `/api/paper/accounts/${acc.id}/state`)).body as {
      positions: PaperPosition[];
    };
  const order = (over: Record<string, unknown>) =>
    req('POST', '/api/paper/orders', {
      accountId: acc.id,
      symbolId: 'fake:AAA',
      side: 'buy',
      type: 'market',
      qty: 10,
      ...over,
    });
  /** Dois dias depois, o preço real sobe para 173,40 (sem tocar stop nem alvo). */
  const later = async () => {
    clock = D0 + 73 * DAY + 12 * HOUR;
    const candle = { time: clock, open: 173.4, high: 173.5, low: 173.3, close: 173.4, volume: 1 };
    for (const h of t.fake.handlers) h.onCandle({ candle, closed: false });
    await new Promise((r) => setTimeout(r, 20));
  };
  return { t, req, acc, state, order, later, all };
}

describe('feedback depois do trade de treino (rota)', () => {
  it('trade com plano: candles reais da escala do setup, mesmo detector e itens com números', async () => {
    const { t, req, state, order, later, all } = await setup();
    const buy = await order({ stopLoss: 167.49, takeProfit: 175.65, plan: PLAN });
    expect(buy.body.status).toBe('filled');
    expect(buy.body.fillPrice).toBe(171.03); // 171,01 + meio spread
    const pos = (await state()).positions[0]!;
    // ainda aberta: sem feedback
    const early = await req('GET', `/api/paper/positions/${pos.id}/feedback`);
    expect(early.status).toBe(400);
    expect(early.body.error).toBe('o feedback sai quando o trade é encerrado');

    await later();
    await order({ side: 'sell' }); // encerra à mão, no lucro
    await vi.waitFor(async () => expect((await state()).positions).toHaveLength(0));
    t.fake.candles = all; // a fonte agora tem os candles depois da saída

    const r = await req('GET', `/api/paper/positions/${pos.id}/feedback`);
    expect(r.status).toBe(200);
    const fb = r.body as FeedbackBody;
    expect(fb.tf).toBe('1d');
    expect(fb.source).toBe('Fonte de teste');
    const by = Object.fromEntries(fb.items.map((x) => [x.key, x]));
    expect(by.plano).toMatchObject({ status: 'ok' });
    expect(by.gatilho!.status).toBe('ok');
    expect(by.gatilho!.detalhe).toMatch(/Setup 9\.2 armado .* gatilho em 170,21/);
    expect(by.escala).toMatchObject({ status: 'ok' });
    // risco: (171,03 − 167,49) × 10 × US$ 5 ÷ R$ 50 mil = 0,35% (limite padrão 2%)
    expect(by.risco!.status).toBe('ok');
    expect(by.risco!.detalhe).toMatch(/0,35% do patrimônio.*2,00%/);
    expect(by.stop).toMatchObject({ status: 'ok' });
    // saiu a 173,38 e o preço chegou ao alvo de 175,65 depois
    expect(by.saida!.status).toBe('atencao');
    expect(by.saida!.detalhe).toMatch(/173,38.*alvo planejado de 175,65.*realizou cedo/);
    expect(by['setup-puro']!.status).toBe('atencao');
    expect(fb.pure).toMatchObject({ setup: 's92', state: 'encerrado', exit: 'alvo' });
    expect(fb.pure!.setupR).toBeCloseTo(2, 6);
    expect(fb.pure!.realR).toBeGreaterThan(0.5);
    expect(fb.pure!.realR).toBeLessThan(0.65);
  });

  it('fonte falhou: itens que dependem de candles ficam "sem dados" com o motivo', async () => {
    const { t, req, state, order, later } = await setup();
    await order({ stopLoss: 167.49, takeProfit: 175.65, plan: PLAN });
    const pos = (await state()).positions[0]!;
    await later();
    await order({ side: 'sell' });
    await vi.waitFor(async () => expect((await state()).positions).toHaveLength(0));
    t.fake.fail = 'fonte fora do ar';
    const fb = (await req('GET', `/api/paper/positions/${pos.id}/feedback`)).body as FeedbackBody;
    const by = Object.fromEntries(fb.items.map((x) => [x.key, x]));
    for (const k of ['gatilho', 'saida', 'setup-puro'] as const) {
      expect(by[k]!.status).toBe('sem-dados');
      expect(by[k]!.detalhe).toMatch(/fonte fora do ar/);
    }
    // o que não depende de candles continua avaliado
    expect(by.plano!.status).toBe('ok');
    expect(by.risco!.status).toBe('ok');
    expect(fb.pure).toBeNull();
  });

  it('sem plano e sem stop: atenção no plano, no risco e no stop; diário como escala', async () => {
    const { req, state, order, later } = await setup();
    await order({});
    const pos = (await state()).positions[0]!;
    await later();
    await order({ side: 'sell' });
    await vi.waitFor(async () => expect((await state()).positions).toHaveLength(0));
    const fb = (await req('GET', `/api/paper/positions/${pos.id}/feedback`)).body as FeedbackBody;
    expect(fb.tf).toBe('1d');
    const by = Object.fromEntries(fb.items.map((x) => [x.key, x.status]));
    expect(by).toMatchObject({
      plano: 'atencao',
      gatilho: 'sem-dados',
      escala: 'sem-dados',
      risco: 'atencao',
      stop: 'atencao',
    });
  });

  it('só o dono vê; trade inexistente = 404 com mensagem em PT-BR', async () => {
    const { t, req, state, order, later } = await setup();
    await order({ stopLoss: 167.49 });
    const pos = (await state()).positions[0]!;
    await later();
    await order({ side: 'sell' });
    await vi.waitFor(async () => expect((await state()).positions).toHaveLength(0));
    const missing = await req('GET', '/api/paper/positions/nao-existe-123/feedback');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('trade não encontrado');
    // outro usuário (id diferente) não enxerga o trade
    await expect(t.paper.feedback(999_999, pos.id)).rejects.toMatchObject({ status: 404 });
  });
});
