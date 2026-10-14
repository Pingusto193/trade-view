import type {
  CandlesResponse,
  Mt5AgentStatus,
  Mt5IngestInput,
  Mt5IngestResponse,
  Mt5Rate,
  Mt5SymbolInfo,
} from '@radar/shared';
import { AdapterRegistry } from '@radar/data';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb } from '../src/db/client';
import { envSchema } from '../src/env';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const json = { 'content-type': 'application/json' };
const NOW = Date.UTC(2026, 0, 14, 15, 0); // quarta 12:00 em Brasília
const PW = 'senha-bem-longa-123';

const EURUSD: Mt5SymbolInfo = {
  name: 'EURUSD',
  description: 'Euro vs US Dollar',
  path: 'Forex\\EURUSD',
  exchange: '',
  currency_base: 'EUR',
  currency_profit: 'USD',
  digits: 5,
  point: 0.00001,
  trade_tick_size: 0.00001,
  trade_tick_value: 1,
  trade_contract_size: 100_000,
  volume_min: 0.01,
  volume_step: 0.01,
  trade_calc_mode: 0,
  market: 'auto',
};

const day = (d: number) => Date.UTC(2026, 0, d);
const rate = (wallMs: number, close: number, tickVol = 50): Mt5Rate => [
  wallMs / 1000,
  close,
  close + 0.001,
  close - 0.001,
  close,
  tickVol,
  1,
  0,
];

function body(over: Partial<Mt5IngestInput> = {}, agent: Partial<Mt5IngestInput['agent']> = {}) {
  return {
    protocol: 1,
    agent: {
      version: '1.0.0',
      mode: 'mt5',
      terminalConnected: true,
      company: 'Corretora Teste',
      serverTz: 'UTC',
      ...agent,
    },
    ...over,
  };
}

function poster(app: FastifyInstance) {
  return (token: string | null, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/mt5/ingest',
      headers: { ...json, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      payload: JSON.stringify(payload),
    });
}

async function newToken(app: FastifyInstance, name = 'PC de casa', cookie?: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/mt5/tokens',
    headers: { ...json, ...(cookie ? { cookie } : {}) },
    payload: JSON.stringify({ name }),
  });
  expect(r.statusCode).toBe(200);
  return r.json<{ id: number; token: string; name: string; url: string }>();
}

/** Faz o papel do agente até o servidor parar de pedir histórico (responde com 30 dias). */
async function serveHistory(post: ReturnType<typeof poster>, token: string) {
  for (let i = 0; i < 50; i++) {
    const r = (await post(token, body())).json<Mt5IngestResponse>();
    if (r.history.length) {
      const bars = r.history.map((h) => ({
        symbol: h.symbol,
        tf: h.tf,
        history: true,
        rates: Array.from({ length: 30 }, (_, k) => rate(day(1) + k * 86_400_000, 1.1 + k / 1000)),
      }));
      return (await post(token, body({ bars }))).json<Mt5IngestResponse>();
    }
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error('o servidor não pediu histórico');
}

describe('agente MT5: tokens e ingestão', () => {
  it('sem token, token errado ou revogado → 401; envio inválido → 400', async () => {
    const t = await testApp({ now: NOW });
    close = () => t.app.close();
    const post = poster(t.app);
    expect((await post(null, body())).statusCode).toBe(401);
    expect((await post('rmt5_naoexiste123456', body())).statusCode).toBe(401);
    const tok = await newToken(t.app);
    expect(tok.token).toMatch(/^rmt5_/);
    expect(tok.url).toBe('http://localhost:5173');
    const bad = await post(tok.token, { protocol: 1, agent: { mode: 'mt5' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('Envio inválido');
    expect((await post(tok.token, body())).statusCode).toBe(200);
    const del = await t.app.inject({ method: 'DELETE', url: `/api/mt5/tokens/${tok.id}` });
    expect(del.statusCode).toBe(200);
    expect((await post(tok.token, body())).statusCode).toBe(401);
    const list = (await t.app.inject({ url: '/api/mt5/agents' })).json<{
      agents: Mt5AgentStatus[];
    }>();
    expect(list.agents).toEqual([]);
  });

  it('o token fica só como hash no banco', async () => {
    const t = await testApp({ now: NOW });
    close = () => t.app.close();
    const tok = await newToken(t.app);
    const rows = t.db.$client.prepare('SELECT token_hash FROM mt5_tokens').all() as {
      token_hash: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).not.toContain(tok.token);
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('com login ligado: ingestão vale só pelo token; gerar token exige login', async () => {
    const t = await testApp({ auth: true, now: NOW });
    close = () => t.app.close();
    expect((await t.app.inject({ method: 'POST', url: '/api/mt5/tokens' })).statusCode).toBe(401);
    const reg = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: json,
      payload: JSON.stringify({ email: 'eu@exemplo.com', password: PW }),
    });
    const c = reg.cookies.find((x) => x.name === 'radar_sid');
    const cookie = `radar_sid=${c?.value}`;
    const tok = await newToken(t.app, 'PC', cookie);
    const r = await poster(t.app)(tok.token, body({ symbols: [EURUSD] }));
    expect(r.statusCode).toBe(200);
    expect(r.json<Mt5IngestResponse>().ok).toBe(true);
    // a busca segue exigindo login
    expect((await t.app.inject({ url: '/api/symbols/search?q=EUR' })).statusCode).toBe(401);
  });

  it('teste de conexão (--check): responde OK e aparece na tela como teste', async () => {
    const t = await testApp({ now: NOW });
    close = () => t.app.close();
    const tok = await newToken(t.app);
    const r = await poster(t.app)(tok.token, body({}, { mode: 'check', terminalConnected: false }));
    expect(r.statusCode).toBe(200);
    expect(r.json<Mt5IngestResponse>().messages[0]).toContain('Conexão com o Radar OK');
    const a = (await t.app.inject({ url: '/api/mt5/agents' })).json<{ agents: Mt5AgentStatus[] }>()
      .agents[0];
    expect(a).toMatchObject({ mode: 'check', online: false, lastSeenAt: NOW });
  });

  it('servidor sem RADAR_SIMULATED recusa o simulador do agente (403, explicado)', async () => {
    const t = await testApp({ now: NOW });
    close = () => t.app.close();
    const tok = await newToken(t.app);
    const r = await poster(t.app)(tok.token, body({ symbols: [EURUSD] }, { mode: 'simulated' }));
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toContain('DADOS SIMULADOS');
    const res = (await t.app.inject({ url: '/api/symbols/search?q=EUR' })).json<{
      results: { id: string }[];
    }>().results;
    expect(res.filter((r) => r.id.startsWith('mt5'))).toEqual([]);
  });

  it('com RADAR_SIMULATED: dados do simulador entram como mt5sim, com a faixa de simulado', async () => {
    const now = { t: NOW };
    const t = await testApp({ now: () => now.t, simulated: true });
    close = () => t.app.close();
    const tok = await newToken(t.app);
    const post = poster(t.app);
    await post(tok.token, body({ symbols: [EURUSD] }, { mode: 'simulated' }));
    const search = (await t.app.inject({ url: '/api/symbols/search?q=EUR' }))
      .json<{
        results: { id: string; name: string }[];
      }>()
      .results.filter((r) => !r.id.startsWith('fake:'));
    expect(search.map((s) => s.id)).toEqual(['mt5sim:EURUSD']);
    expect(search[0]?.name).toContain('SIMULADO');
    const pending = t.app.inject({ url: '/api/candles?id=mt5sim:EURUSD&tf=1d&limit=10' });
    for (let i = 0; i < 50; i++) {
      const r = (await post(tok.token, body({}, { mode: 'simulated' }))).json<Mt5IngestResponse>();
      if (r.history.length) {
        await post(
          tok.token,
          body(
            {
              bars: [
                {
                  symbol: 'EURUSD',
                  tf: '1d',
                  history: true,
                  rates: [rate(day(13), 1.1), rate(day(14), 1.2)],
                },
              ],
            },
            { mode: 'simulated' },
          ),
        );
        break;
      }
      await new Promise((res) => setTimeout(res, 5));
    }
    const c = (await pending).json<CandlesResponse>();
    expect(c.meta.delay).toEqual({ kind: 'simulated' });
    expect(c.candles).toHaveLength(2);
    const sources = (await t.app.inject({ url: '/api/sources' })).json<{
      sources: { id: string; simulated: boolean }[];
    }>().sources;
    expect(sources.find((s) => s.id === 'mt5sim')?.simulated).toBe(true);
    expect(sources.find((s) => s.id === 'mt5')?.simulated).toBe(false);
  });

  it('fluxo completo: busca, histórico pelo agente, tick volume; agente some → cache com erro', async () => {
    const now = { t: NOW };
    const t = await testApp({ now: () => now.t });
    close = () => t.app.close();
    const tok = await newToken(t.app);
    const post = poster(t.app);
    const r0 = (await post(tok.token, body({ symbols: [EURUSD] }))).json<Mt5IngestResponse>();
    expect(r0.wants).toEqual([]);
    const found = (await t.app.inject({ url: '/api/symbols/search?q=eurusd' }))
      .json<{
        results: { id: string; market: string }[];
      }>()
      .results.filter((r) => !r.id.startsWith('fake:'));
    expect(found).toEqual([expect.objectContaining({ id: 'mt5:EURUSD', market: 'forex' })]);

    const pending = t.app.inject({ url: '/api/candles?id=mt5:EURUSD&tf=1d&limit=20' });
    await serveHistory(post, tok.token);
    const c = (await pending).json<CandlesResponse>();
    expect(c.status.state).toBe('ok');
    expect(c.candles).toHaveLength(20);
    expect(c.meta.volume).toBe('tick');
    expect(c.meta.notes.join(' ')).toContain('NÃO é volume negociado');
    expect(c.meta.market).toBe('forex');

    const agents = (await t.app.inject({ url: '/api/mt5/agents' })).json<{
      agents: Mt5AgentStatus[];
    }>().agents;
    expect(agents[0]).toMatchObject({
      name: 'PC de casa',
      online: true,
      mode: 'mt5',
      company: 'Corretora Teste',
      symbols: ['EURUSD'],
      terminalConnected: true,
    });
    expect(agents[0]?.clock).toContain('configurado');

    // o PC desligou: depois de 1 minuto sem contato, o gráfico mostra o cache e o erro honesto
    now.t += 60_000;
    const off = (
      await t.app.inject({ url: '/api/candles?id=mt5:EURUSD&tf=1d&limit=20' })
    ).json<CandlesResponse>();
    expect(off.status.state).toBe('error');
    expect(off.status.message).toContain('sem contato desde 14/01/2026 12:00');
    expect(off.status.lastValidAt).toBe(NOW);
    expect(off.candles).toHaveLength(20); // cache do SQLite, nunca inventado
    const a2 = (await t.app.inject({ url: '/api/mt5/agents' })).json<{
      agents: Mt5AgentStatus[];
    }>().agents[0];
    expect(a2?.online).toBe(false);
  });

  it('após reiniciar o servidor sem o agente: ativo segue na busca e o cache vem com o erro', async () => {
    const db = openDb(':memory:');
    const env = envSchema.parse({
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      RADAR_DEV_NO_AUTH: '1',
      PUBLIC_URL: 'http://localhost:5173',
    });
    const now = { t: NOW };
    const first = await buildApp({
      env,
      db,
      registry: new AdapterRegistry([]),
      logger: false,
      now: () => now.t,
    });
    const tok = await newToken(first.app);
    const post = poster(first.app);
    await post(tok.token, body({ symbols: [EURUSD] }));
    const pending = first.app.inject({ url: '/api/candles?id=mt5:EURUSD&tf=1d&limit=5' });
    await serveHistory(post, tok.token);
    expect((await pending).json<CandlesResponse>().candles).toHaveLength(5);
    await first.app.close();

    now.t += 3_600_000;
    const second = await buildApp({
      env,
      db,
      registry: new AdapterRegistry([]),
      logger: false,
      now: () => now.t,
    });
    close = () => second.app.close();
    const s = (await second.app.inject({ url: '/api/symbols/search?q=EUR' })).json<{
      results: { id: string; name: string }[];
    }>().results;
    expect(s[0]?.id).toBe('mt5:EURUSD');
    expect(s[0]?.name).toContain('desconectado');
    const c = (
      await second.app.inject({ url: '/api/candles?id=mt5:EURUSD&tf=1d&limit=5' })
    ).json<CandlesResponse>();
    expect(c.status.state).toBe('error');
    expect(c.status.message).toContain('sem contato');
    expect(c.candles).toHaveLength(5);
    expect(c.status.lastValidAt).toBe(NOW);
    const agents = (await second.app.inject({ url: '/api/mt5/agents' })).json<{
      agents: Mt5AgentStatus[];
    }>().agents;
    expect(agents[0]).toMatchObject({ online: false, mode: 'mt5', symbols: ['EURUSD'] });
  });

  it('tempo real pelo WebSocket do app: assinatura vira "wants" do agente e o candle chega', async () => {
    const now = { t: NOW };
    const t = await testApp({ now: () => now.t });
    close = () => t.app.close();
    const tok = await newToken(t.app);
    const post = poster(t.app);
    await post(tok.token, body({ symbols: [EURUSD] }));
    const got: unknown[] = [];
    const off = t.hub.subscribe('mt5:EURUSD', '1m', (m) => got.push(m));
    const r = (await post(tok.token, body())).json<Mt5IngestResponse>();
    expect(r.wants).toEqual([{ symbol: 'EURUSD', tf: '1m' }]);
    await post(
      tok.token,
      body({
        bars: [{ symbol: 'EURUSD', tf: '1m', rates: [rate(NOW - 60_000, 1.1), rate(NOW, 1.2)] }],
      }),
    );
    expect(got).toContainEqual(
      expect.objectContaining({ type: 'candle', id: 'mt5:EURUSD', closed: true }),
    );
    expect(got).toContainEqual(
      expect.objectContaining({
        type: 'candle',
        closed: false,
        candle: expect.objectContaining({ time: NOW, close: 1.2 }),
      }),
    );
    // o candle fechado foi para o cache do SQLite
    expect(t.store.load('mt5:EURUSD', '1m')).toHaveLength(1);
    off();
  });
});
