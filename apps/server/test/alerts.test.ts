import type { Alert, AlertFire, Candle } from '@radar/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOURCE_DOWN_MS } from '../src/alerts/service';
import { isQuiet } from '../src/notify/quiet';
import { DAY, FakeSenders, series, testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await close?.();
  close = null;
});

const SUB = {
  endpoint: 'https://push.exemplo.com/assinatura-1',
  keys: { p256dh: 'BOr5x3ZpY7m0kQ9wA1b2c3d4e5f6', auth: 'qwertyuiopas' },
  label: 'iPhone',
};

async function setup(opts: { now?: () => number } = {}) {
  const fx = new FakeSenders();
  const t = await testApp({ senders: fx, ...(opts.now ? { now: opts.now } : {}) });
  close = () => t.app.close();
  // 60 candles diários: fechamentos 100,5 … 159,5
  t.fake.candles = series(60, Date.UTC(2026, 0, 1));
  const req = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, body?: unknown) =>
    t.app.inject({
      method,
      url,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
  const last = t.fake.candles.at(-1)!;
  const next = (i: number, close: number, closed = true): void => {
    const c: Candle = {
      time: last.time + i * DAY,
      open: close,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 10,
    };
    for (const h of t.fake.handlers) h.onCandle({ candle: c, closed });
  };
  const history = async (): Promise<AlertFire[]> =>
    (await req('GET', '/api/alerts/history')).json().fires;
  const settle = async (n = 1) => {
    await vi.waitFor(async () => expect((await history()).length).toBeGreaterThanOrEqual(n));
  };
  return { t, fx, req, next, history, settle };
}

const priceAlert = (over: Record<string, unknown> = {}) => ({
  symbolId: 'fake:AAA',
  tf: '1d',
  condition: { kind: 'price', level: 165, direction: 'up' },
  trigger: 'close',
  channels: ['push', 'telegram', 'email'],
  ...over,
});

describe('alertas no servidor', () => {
  it('preço cruza no fechamento → entrega em push, Telegram e e-mail, com link para o gráfico', async () => {
    const { req, fx, next, history, settle, t } = await setup();
    await req('POST', '/api/notify/push', SUB);
    await req('PUT', '/api/notify/settings', {
      telegramToken: '123456:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789',
      telegramChatId: '4242',
      email: 'eu@exemplo.com',
    });
    const created = await req('POST', '/api/alerts', priceAlert());
    expect(created.statusCode).toBe(200);
    expect(t.alerts.activeSeries).toEqual([expect.stringContaining('fake:AAA|1d')]);

    next(1, 162); // ainda abaixo
    next(2, 166); // cruzou
    await settle();
    const [f] = await history();
    expect(f!.title).toBe('AAA · Diário');
    expect(f!.body).toContain('Fechamento cruzou para cima o nível 165,00');
    expect(f!.url).toBe('http://localhost:5173/grafico?id=fake%3AAAA&tf=1d');
    expect(f!.delivery).toEqual({ push: 'ok', telegram: 'ok', email: 'ok' });
    expect(JSON.parse(fx.push[0]!.payload)).toMatchObject({ title: 'AAA · Diário', url: f!.url });
    expect(fx.telegram[0]!.chatId).toBe('4242');
    expect(fx.email[0]!.to).toBe('eu@exemplo.com');

    // "uma vez": o alerta se desliga e não dispara de novo
    const [a] = (await req('GET', '/api/alerts')).json().alerts as Alert[];
    expect(a!.enabled).toBe(false);
    expect(a!.lastFiredAt).not.toBeNull();
    next(3, 160);
    next(4, 170);
    await new Promise((r) => setTimeout(r, 30));
    expect(await history()).toHaveLength(1);
  });

  it('repetir com intervalo mínimo; o histórico de aquecimento e candles repetidos não disparam', async () => {
    let now = Date.UTC(2026, 5, 1, 15);
    const { req, next, history, settle } = await setup({ now: () => now });
    // nível 150 já foi cruzado no histórico: isso não pode disparar
    await req(
      'POST',
      '/api/alerts',
      priceAlert({
        condition: { kind: 'price', level: 161, direction: 'up' },
        channels: ['push'],
        repeat: 'every',
        cooldownMin: 30,
      }),
    );
    next(1, 162);
    await settle(1);
    next(1, 162); // repetição do mesmo candle (reconexão)
    next(2, 159);
    next(3, 163); // cruza de novo, mas dentro do intervalo mínimo
    await new Promise((r) => setTimeout(r, 30));
    expect(await history()).toHaveLength(1);
    now += 31 * 60_000;
    next(4, 158);
    next(5, 164);
    await settle(2);
    const h = await history();
    expect(h[0]!.delivery.push).toBe('erro: nenhum aparelho ativado');
  });

  it('horário de silêncio: registra como silenciado e não envia', async () => {
    const { req, fx, next, history, settle } = await setup();
    await req('POST', '/api/notify/push', SUB);
    await req('PUT', '/api/notify/settings', {
      quietEnabled: true,
      quietStart: '00:00',
      quietEnd: '23:59',
    });
    await req('POST', '/api/alerts', priceAlert({ channels: ['push'] }));
    next(1, 170);
    await settle();
    const [f] = await history();
    expect(f!.silenced).toBe(true);
    expect(f!.delivery).toEqual({ push: 'silenciado' });
    expect(fx.push).toHaveLength(0);
  });

  it('assinatura de push cancelada no aparelho (410) é removida', async () => {
    const { req, fx, next, settle } = await setup();
    await req('POST', '/api/notify/push', SUB);
    fx.gone.add(SUB.endpoint);
    await req('POST', '/api/alerts', priceAlert({ channels: ['push'] }));
    next(1, 170);
    await settle();
    const s = (await req('GET', '/api/notify/settings')).json();
    expect(s.pushDevices).toHaveLength(0);
  });

  it('alerta de desenho: segue a linha atual e avisa quando o desenho some', async () => {
    const { req, next, history, settle } = await setup();
    const drawing = (price: number) => ({
      symbolId: 'fake:AAA',
      tf: null,
      data: { kind: 'hline', points: [{ time: Date.UTC(2026, 0, 5), price }] },
    });
    await req('PUT', '/api/drawings/linha-000001', drawing(200));
    const a = (
      await req('POST', '/api/alerts', {
        ...priceAlert({ channels: ['push'] }),
        condition: { kind: 'drawing', drawingId: 'linha-000001', event: 'cross-up' },
      })
    ).json() as Alert;
    next(1, 170); // abaixo de 200: nada
    // usuário move a linha para 172 → o servidor recarrega o alerta
    await req('PUT', '/api/drawings/linha-000001', drawing(172));
    await vi.waitFor(async () => {
      next(2, 175);
      expect((await history()).length).toBe(1);
    });
    await settle();
    expect((await history())[0]!.body).toContain('cruzou para cima a linha 172,00');

    await req('DELETE', '/api/drawings/linha-000001');
    await req('PUT', `/api/alerts/${a.id}`, {
      ...priceAlert({ channels: ['push'] }),
      condition: a.condition,
    });
    await vi.waitFor(async () => {
      const [x] = (await req('GET', '/api/alerts')).json().alerts as Alert[];
      expect(x!.status).toBe('o desenho foi apagado');
    });
  });

  it('valida entrada: setup/indicador só no fechamento; canal inválido recusado', async () => {
    const { req } = await setup();
    const bad = await req('POST', '/api/alerts', {
      ...priceAlert(),
      condition: { kind: 'setup', setups: ['s91'] },
      trigger: 'touch',
    });
    expect(bad.statusCode).toBe(400);
    expect((await req('POST', '/api/alerts', priceAlert({ channels: ['sms'] }))).statusCode).toBe(
      400,
    );
    const ok = await req('POST', '/api/alerts', {
      ...priceAlert(),
      condition: { kind: 'setup', setups: ['s91', 'elastic'] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().condition).toMatchObject({ states: ['armado', 'acionado'], sides: ['buy'] });
  });

  it('teste por canal e token do Telegram nunca volta ao navegador', async () => {
    const { req, fx } = await setup();
    let r = await req('POST', '/api/notify/test', { channel: 'telegram' });
    expect(r.json().result).toBe('erro: Telegram não configurado');
    const token = '123456:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789';
    const s = await req('PUT', '/api/notify/settings', { telegramToken: token });
    expect(s.body).not.toContain(token);
    expect(s.json().telegramConfigured).toBe(true);
    const det = await req('POST', '/api/notify/telegram/detect');
    expect(det.json()).toEqual({ chatId: '4242', name: 'Teste' });
    r = await req('POST', '/api/notify/test', { channel: 'telegram' });
    expect(r.json().result).toBe('ok');
    expect(fx.telegram[0]!.text).toContain('Radar — teste');
    expect(JSON.stringify((await req('GET', '/api/notify/settings')).json())).not.toContain(token);
  });

  it('alerta de sistema: fonte com erro por mais de 3 minutos', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { req, t, history } = await setup();
    await req('POST', '/api/alerts', {
      ...priceAlert({ channels: ['push'] }),
      condition: { kind: 'system', event: 'source-down' },
    });
    for (const h of t.fake.handlers) h.onStatus({ state: 'error', message: 'fonte fora do ar' });
    vi.advanceTimersByTime(SOURCE_DOWN_MS + 10);
    vi.useRealTimers();
    await vi.waitFor(async () => expect((await history()).length).toBe(1));
    expect((await history())[0]!.body).toContain('fonte fora do ar');
  });
});

describe('horário de silêncio', () => {
  const at = (h: number, m = 0) => Date.UTC(2026, 5, 1, h + 3, m); // São Paulo = UTC−3
  it('faixa que atravessa a meia-noite', () => {
    expect(isQuiet(at(23), '22:00', '07:00', 'America/Sao_Paulo')).toBe(true);
    expect(isQuiet(at(6, 59), '22:00', '07:00', 'America/Sao_Paulo')).toBe(true);
    expect(isQuiet(at(7), '22:00', '07:00', 'America/Sao_Paulo')).toBe(false);
    expect(isQuiet(at(12), '22:00', '07:00', 'America/Sao_Paulo')).toBe(false);
  });
  it('faixa no mesmo dia e faixa vazia', () => {
    expect(isQuiet(at(13), '12:00', '14:00', 'America/Sao_Paulo')).toBe(true);
    expect(isQuiet(at(14), '12:00', '14:00', 'America/Sao_Paulo')).toBe(false);
    expect(isQuiet(at(13), '10:00', '10:00', 'America/Sao_Paulo')).toBe(false);
  });
});
