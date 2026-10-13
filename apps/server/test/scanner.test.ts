import type { Candle, SavedScan, ScanRow, ScanSnapshot } from '@radar/shared';
import { DISTORTION_FILTERS } from '@radar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { scanResults } from '../src/db/schema';
import { ScannerService } from '../src/scanner/service';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const DAY = 86_400_000;
const MIN = 60_000;
const T0 = Date.UTC(2024, 0, 1);

/** Passeio aleatório determinístico. */
function walk(n: number, step = DAY, start = T0): Candle[] {
  let a = 987654;
  const r = () => (a = (a * 1103515245 + 12345) >>> 0) / 2 ** 32;
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    p = p * Math.exp(0.02 * (r() + r() + r() - 1.5));
    return {
      time: start + i * step,
      open: o,
      high: Math.max(o, p) * (1 + 0.006 * r()),
      low: Math.min(o, p) * (1 - 0.006 * r()),
      close: p,
      volume: 1000 + 1000 * r(),
    };
  });
}

/** 300 dias em torno de 100 e depois 400 dias caindo até 30 (queda longa, médias semanais descendo). */
function longDrop(): Candle[] {
  return Array.from({ length: 700 }, (_, i) => {
    const c = i < 300 ? 100 + (i % 2 ? 0.5 : -0.5) : 100 - ((i - 299) * 70) / 400;
    const o = i < 300 ? 100 : c + 70 / 400;
    return {
      time: T0 + i * DAY,
      open: o,
      high: Math.max(o, c) + 0.5,
      low: Math.min(o, c) - 0.5,
      close: c,
      volume: 1000,
    };
  });
}

/** "Agora": meio-dia do dia seguinte ao último candle diário (o candle 699 já fechou). */
const NOW = T0 + 700 * DAY + 12 * 3600_000;

async function setup(opts: { auth?: boolean } = {}) {
  let now = NOW;
  const t = await testApp({ now: () => now, ...(opts.auth ? { auth: true } : {}) });
  close = () => t.app.close();
  t.fake.candles = walk(700);
  t.scanner.debounceMs = 10;
  const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) =>
    t.app.inject({
      method,
      url,
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }
        : {}),
    });
  // portão: segura a fonte até o teste liberar (para ver a varredura "rodando")
  let open: () => void = () => {};
  let gate = Promise.resolve();
  const orig = t.fake.getCandles.bind(t.fake);
  t.fake.getCandles = async (r) => {
    await gate;
    return orig(r);
  };
  const list = (
    await req('POST', '/api/watchlists', {
      name: 'Teste',
      items: ['fake:AAA', 'fake:BBB', 'nada:XYZ'],
    })
  ).json() as { id: number };
  const done = async () => {
    await t.scanner.idle();
    return (await req('GET', '/api/scanner/adhoc')).json().snapshot as ScanSnapshot;
  };
  return {
    t,
    req,
    list,
    done,
    setNow: (v: number) => (now = v),
    hold: () => (gate = new Promise<void>((ok) => (open = ok))),
    release: () => open(),
  };
}

const row = (s: ScanSnapshot, id: string) => s.rows.find((r) => r.symbolId === id) as ScanRow;

describe('scanner no servidor (SPEC §14)', () => {
  it('varredura avulsa: em segundo plano, um ativo por vez, linha de erro por ativo e fonte/atraso em cada linha', async () => {
    const { t, req, list, done, hold, release } = await setup();
    hold();
    const res = await req('POST', '/api/scanner/run', {
      universe: { kind: 'watchlist', id: list.id },
      tf: '1d',
    });
    expect(res.statusCode).toBe(200);
    const started = res.json() as ScanSnapshot;
    expect(started.running).toMatchObject({ total: 3 });
    expect(started.universeLabel).toBe('Lista: Teste');
    // uma varredura avulsa por vez
    const again = await req('POST', '/api/scanner/run', {
      universe: { kind: 'watchlist', id: list.id },
      tf: '1d',
    });
    expect(again.statusCode).toBe(409);
    release();

    const snap = await done();
    expect(snap.running).toBeNull();
    expect(snap.lastRun).toMatchObject({ status: 'done', trigger: 'manual', symbols: 3 });
    expect(snap.rows.map((r) => r.symbolId)).toEqual(['fake:AAA', 'fake:BBB', 'nada:XYZ']);
    const a = row(snap, 'fake:AAA');
    expect(a.error).toBeNull();
    expect(a.analysis!.lastTime).toBe(T0 + 699 * DAY);
    expect(a.analysis!.lastClose).toBe(t.fake.candles[699]!.close);
    expect(a.analysis!.spark).toHaveLength(60);
    // semanal montado dos 600 diários pedidos (dias 100 a 699 = semanas 14 a 99), sem chamada extra
    expect(a.analysis!.weekly).toMatchObject({ bars: 86, lastTime: T0 + 693 * DAY });
    expect(a.source).toMatchObject({
      label: 'Fonte de teste',
      delay: { kind: 'realtime' },
      volume: 'complete',
      simulated: false,
      status: { state: 'ok' },
    });
    expect(a.filter).toMatchObject({ pass: true });
    expect(row(snap, 'nada:XYZ')).toMatchObject({ analysis: null, filter: { pass: false } });
    expect(row(snap, 'nada:XYZ').error).toMatch(/fonte desconhecida/);
    expect(t.fake.calls).toBe(2);
  });

  it('o candle em formação fica de fora: a linha usa só o último candle FECHADO', async () => {
    const { req, list, done, setNow } = await setup();
    setNow(T0 + 699 * DAY + 12 * 3600_000); // o diário 699 ainda está em formação (cripto, 24 h)
    await req('POST', '/api/scanner/run', {
      universe: { kind: 'watchlist', id: list.id },
      tf: '1d',
    });
    expect(row(await done(), 'fake:AAA').analysis!.lastTime).toBe(T0 + 698 * DAY);
  });

  it('escala que a fonte não oferece e fonte com erro viram linhas de erro (nunca inventa)', async () => {
    const { t, req, list, done } = await setup();
    await req('POST', '/api/scanner/run', {
      universe: { kind: 'watchlist', id: list.id },
      tf: '60m',
    });
    expect(row(await done(), 'fake:AAA').error).toBe('Fonte de teste não oferece a escala 60 min');

    // fonte caiu: o erro aparece com o motivo e a data do último dado válido (do cache)
    await req('POST', '/api/scanner/run', {
      universe: { kind: 'watchlist', id: list.id },
      tf: '1d',
    });
    await done();
    t.fake.fail = 'servidor da fonte fora do ar';
    await req('POST', '/api/scanner/run', {
      universe: { kind: 'watchlist', id: list.id },
      tf: '1d',
    });
    const bad = row(await done(), 'fake:AAA');
    expect(bad.analysis).toBeNull();
    expect(bad.error).toMatch(
      /^Erro na fonte: servidor da fonte fora do ar — último dado válido em/,
    );
    expect(bad.source?.status.state).toBe('error');
  });

  it('filtro "Distorção (reflexividade)": ativo sem fonte de fundamentos (cripto) passa só na parte gráfica', async () => {
    const { t, req, list, done } = await setup();
    t.fake.candles = longDrop();
    await req('POST', '/api/scanner/run', {
      universe: { kind: 'watchlist', id: list.id },
      tf: '1d',
      filters: DISTORTION_FILTERS,
    });
    const a = row(await done(), 'fake:AAA');
    expect(a.analysis!.weekly!.slopes).toEqual({ ema21: 'descendo', sma50: 'descendo' });
    expect(a.analysis!.drawdown.w52!).toBeGreaterThan(0.5);
    expect(a.filter).toMatchObject({ pass: false, chartOnly: true });
    expect(a.filter!.reasons).toEqual([
      'fundamentos não verificados (sem fonte de fundamentos para este ativo)',
    ]);
  });

  it('varreduras salvas: criar, rodar, trocar filtros sem varrer de novo, zerar ao trocar a escala, apagar', async () => {
    const { t, req, list } = await setup();
    const input = {
      name: 'Minha varredura',
      universe: { kind: 'watchlist', id: list.id },
      tf: '1d',
      filters: {},
    };
    // validações: agenda intradiária só para listas e escalas intradiárias
    expect(
      (await req('POST', '/api/scanner/saved', { ...input, schedule: 'intraday' })).statusCode,
    ).toBe(400);
    expect(
      (
        await req('POST', '/api/scanner/saved', {
          ...input,
          tf: '15m',
          universe: { kind: 'suggested', id: 'cripto' },
          schedule: 'intraday',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await req('POST', '/api/scanner/saved', {
          ...input,
          universe: { kind: 'watchlist', id: 999 },
        })
      ).statusCode,
    ).toBe(404);
    // o conjunto simulado não existe fora do desenvolvimento
    expect(
      (
        await req('POST', '/api/scanner/run', {
          universe: { kind: 'suggested', id: 'sim' },
          tf: '1d',
        })
      ).statusCode,
    ).toBe(400);

    const saved = (await req('POST', '/api/scanner/saved', input)).json() as SavedScan;
    expect(saved.schedule).toBe('off');
    expect((await req('POST', `/api/scanner/saved/${saved.id}/run`)).statusCode).toBe(200);
    await t.scanner.idle();
    const result = async () =>
      (await req('GET', `/api/scanner/saved/${saved.id}/result`)).json().snapshot as ScanSnapshot;
    expect((await result()).rows).toHaveLength(3);
    const calls = t.fake.calls;

    // filtro novo vale na hora, sem buscar dados de novo
    await req('PUT', `/api/scanner/saved/${saved.id}`, { ...input, filters: { adxMin: 99 } });
    const filtered = await result();
    expect(filtered.rows.filter((r) => r.filter?.pass)).toHaveLength(0);
    expect(row(filtered, 'fake:AAA').filter!.reasons[0]).toMatch(/^ADX .* abaixo de 99$/);
    expect(t.fake.calls).toBe(calls);
    const listed = (await req('GET', '/api/scanner/saved')).json().scans as SavedScan[];
    expect(listed[0]!.summary).toMatchObject({ rows: 3, pass: 0, errors: 1, running: false });

    // trocar a escala zera a tabela (era de outra escala)
    await req('PUT', `/api/scanner/saved/${saved.id}`, { ...input, tf: '1w' });
    expect((await result()).rows).toEqual([]);

    expect((await req('DELETE', `/api/scanner/saved/${saved.id}`)).statusCode).toBe(200);
    expect((await req('GET', `/api/scanner/saved/${saved.id}/result`)).statusCode).toBe(404);
    expect(
      t.db
        .select()
        .from(scanResults)
        .all()
        .filter((r) => r.scanId),
    ).toEqual([]);
  });

  it('agenda diária: roda quando há pregão novo fechado, uma vez por pregão', async () => {
    const { t, req, list, setNow } = await setup();
    const saved = (
      await req('POST', '/api/scanner/saved', {
        name: 'Diária',
        universe: { kind: 'watchlist', id: list.id },
        tf: '1d',
        schedule: 'daily',
      })
    ).json() as SavedScan;
    const result = async () =>
      (await req('GET', `/api/scanner/saved/${saved.id}/result`)).json().snapshot as ScanSnapshot;

    await t.scanner.tick();
    await t.scanner.idle();
    const first = await result();
    expect(first.lastRun).toMatchObject({ trigger: 'daily', symbols: 3 });
    expect(row(first, 'fake:AAA').trigger).toBe('daily');
    expect(t.fake.calls).toBe(2);

    // mesmo pregão: nada a fazer
    await t.scanner.tick();
    await t.scanner.idle();
    expect(t.fake.calls).toBe(2);

    // dia seguinte (o diário de ontem fechou à meia-noite UTC): roda de novo
    setNow(NOW + DAY);
    t.fake.candles = walk(701);
    await t.scanner.tick();
    await t.scanner.idle();
    expect(t.fake.calls).toBe(4);
    expect(row(await result(), 'fake:AAA').analysis!.lastTime).toBe(T0 + 700 * DAY);
  });

  it('agenda intradiária (só listas): varre de novo o ativo a cada candle fechado', async () => {
    const { t, req, list, setNow } = await setup();
    // escala de 1 min: candles até 2 min atrás
    const now = NOW;
    setNow(now);
    t.fake.candles = walk(600, MIN, now - 601 * MIN);
    await req('PUT', `/api/watchlists/${list.id}`, { name: 'Teste', items: ['fake:AAA'] });
    const saved = (
      await req('POST', '/api/scanner/saved', {
        name: 'Ao vivo',
        universe: { kind: 'watchlist', id: list.id },
        tf: '1m',
        schedule: 'intraday',
      })
    ).json() as SavedScan;
    await t.scanner.syncSubscriptions();
    await t.scanner.idle();
    const result = async () =>
      (await req('GET', `/api/scanner/saved/${saved.id}/result`)).json().snapshot as ScanSnapshot;
    const first = await result();
    expect(first.lastRun).toMatchObject({ trigger: 'intraday', symbols: 1 });
    expect(t.scanner.liveSymbols).toEqual([`${saved.id}|fake:AAA|1m`]);
    expect(t.fake.handlers).toHaveLength(1);
    const calls = t.fake.calls;

    // fecha um candle novo de 1 min: o servidor varre só esse ativo de novo
    const last = t.fake.candles.at(-1)!;
    const fresh = { ...last, time: now - MIN, open: last.close, close: last.close * 1.01 };
    fresh.high = Math.max(fresh.high, fresh.close);
    t.fake.handlers[0]!.onCandle({ candle: fresh, closed: true });
    t.fake.handlers[0]!.onCandle({ candle: fresh, closed: true }); // repetido: ignorado
    await new Promise((ok) => setTimeout(ok, 50));
    await t.scanner.idle();
    expect(t.fake.calls).toBe(calls + 1);
    const after = row(await result(), 'fake:AAA');
    expect(after.trigger).toBe('intraday');
    expect(after.analysis!.lastTime).toBe(now - MIN);

    // agenda desligada: para de acompanhar
    await req('PUT', `/api/scanner/saved/${saved.id}`, {
      name: 'Ao vivo',
      universe: { kind: 'watchlist', id: list.id },
      tf: '1m',
      schedule: 'off',
    });
    await t.scanner.syncSubscriptions();
    expect(t.scanner.liveSymbols).toEqual([]);
  });

  it('servidor reiniciado no meio: a varredura vira erro com explicação (não fica "rodando")', async () => {
    const { t, req, list, hold, release } = await setup();
    hold();
    await req('POST', '/api/scanner/run', {
      universe: { kind: 'watchlist', id: list.id },
      tf: '1d',
    });
    expect(t.db.select().from(scanResults).get()!.running).toBe(true);
    const fresh = new ScannerService(t.db, t.market, t.hub, t.sync, t.app.log, false);
    const snap = fresh.adhoc(t.db.select().from(scanResults).get()!.userId)!;
    expect(snap.running).toBeNull();
    expect(snap.lastRun).toMatchObject({ status: 'error' });
    expect(snap.lastRun!.error).toMatch(/reiniciou/);
    fresh.close();
    release();
    await t.scanner.idle();
  });

  it('universos: listas do usuário + conjuntos sugeridos (sem o simulado fora do desenvolvimento)', async () => {
    const { req } = await setup();
    const u = (await req('GET', '/api/scanner/universes')).json();
    expect(u.watchlists).toEqual([{ id: expect.any(Number), name: 'Teste', count: 3 }]);
    expect(u.suggested.map((s: { id: string }) => s.id)).toEqual(['b3', 'cripto', 'eua']);
    expect(u.limits).toEqual({ maxSymbols: 60, maxIntraday: 20 });
  });

  it('tudo atrás de login e cada um só vê as próprias varreduras', async () => {
    const { t } = await setup({ auth: true });
    const post = (url: string, body: unknown, cookie?: string) =>
      t.app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        payload: JSON.stringify(body),
      });
    const ck = (r: { cookies: { name: string; value: string }[] }) =>
      `radar_sid=${r.cookies.find((c) => c.name === 'radar_sid')?.value}`;
    expect((await t.app.inject({ url: '/api/scanner/universes' })).statusCode).toBe(401);
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
    const listA = (await post('/api/watchlists', { name: 'A', items: ['fake:AAA'] }, a)).json();
    // b não usa a lista de a
    expect(
      (
        await post(
          '/api/scanner/run',
          { universe: { kind: 'watchlist', id: listA.id }, tf: '1d' },
          b,
        )
      ).statusCode,
    ).toBe(404);
    const saved = (
      await post(
        '/api/scanner/saved',
        { name: 'de A', universe: { kind: 'watchlist', id: listA.id }, tf: '1d' },
        a,
      )
    ).json() as SavedScan;
    const get = (url: string, cookie: string) => t.app.inject({ url, headers: { cookie } });
    expect((await get(`/api/scanner/saved/${saved.id}/result`, b)).statusCode).toBe(404);
    expect((await post(`/api/scanner/saved/${saved.id}/run`, {}, b)).statusCode).toBe(404);
    expect((await get('/api/scanner/saved', b)).json().scans).toEqual([]);
    expect((await get('/api/scanner/saved', a)).json().scans).toHaveLength(1);
  });
});
