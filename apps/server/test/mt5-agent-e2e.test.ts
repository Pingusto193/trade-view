import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { CandlesResponse, Mt5AgentStatus, ServerMessage } from '@radar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

/**
 * Ponta a ponta do protocolo: servidor de verdade (porta local) + agente Python de verdade em modo
 * simulador. Pula se não houver python3 na máquina.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AGENT = `${ROOT}agents/mt5-bridge/radar_mt5.py`;
const PY = ['python3', 'python'].find(
  (p) => spawnSync(p, ['--version'], { stdio: 'ignore' }).status === 0,
);

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
});

function runAgent(args: string[]): {
  child: ChildProcess;
  out: () => string;
  done: Promise<number>;
} {
  const child = spawn(PY as string, [AGENT, ...args], {
    cwd: ROOT,
    env: { ...process.env, PYTHONUNBUFFERED: '1', RADAR_MT5_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  child.stdout?.on('data', (b: Buffer) => (text += b.toString()));
  child.stderr?.on('data', (b: Buffer) => (text += b.toString()));
  const done = new Promise<number>((res) => child.on('exit', (code) => res(code ?? -1)));
  cleanup.push(async () => {
    if (child.exitCode === null) {
      child.kill();
      await done;
    }
  });
  return { child, out: () => text, done };
}

async function until<T>(fn: () => Promise<T | null | undefined>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('tempo esgotado esperando o agente');
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function server(simulated: boolean, skew = { ms: 0 }) {
  const t = await testApp({ simulated, now: () => Date.now() + skew.ms });
  await t.app.listen({ host: '127.0.0.1', port: 0 });
  cleanup.push(() => t.app.close());
  const port = (t.app.server.address() as AddressInfo).port;
  const tok = (
    await t.app.inject({
      method: 'POST',
      url: '/api/mt5/tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Teste ponta a ponta' }),
    })
  ).json<{ token: string }>().token;
  return { t, url: `http://127.0.0.1:${port}`, token: tok };
}

describe.skipIf(!PY)('agente MT5 (Python) ↔ servidor, de ponta a ponta com o simulador', () => {
  it('o simulador alimenta o app: busca, histórico, tempo real e a marca DADOS SIMULADOS', async () => {
    const skew = { ms: 0 };
    const { t, url, token } = await server(true, skew);
    const agent = runAgent([
      '--simulate',
      '--url',
      url,
      '--token',
      token,
      '--symbols',
      'EURUSD,WIN$N',
      '--duration',
      '60',
    ]);
    const found = await until(async () => {
      const r = (await t.app.inject({ url: '/api/symbols/search?q=EURUSD' })).json<{
        results: { id: string; name: string }[];
      }>();
      return r.results.find((x) => x.id === 'mt5sim:EURUSD');
    });
    expect(found.name).toContain('SIMULADO');

    const fx = (
      await t.app.inject({ url: '/api/candles?id=mt5sim:EURUSD&tf=5m&limit=100' })
    ).json<CandlesResponse>();
    expect(fx.status.state).toBe('ok');
    expect(fx.candles).toHaveLength(100);
    expect(fx.meta.delay).toEqual({ kind: 'simulated' });
    expect(fx.meta.volume).toBe('tick');
    expect(fx.meta.market).toBe('forex');
    // horários convertidos para UTC e alinhados a 5 min, terminando agora
    const last = fx.candles.at(-1);
    expect(last && last.time % 300_000).toBe(0);
    expect(Math.abs(Date.now() - (last?.time ?? 0))).toBeLessThan(10 * 60_000);

    const win = (
      await t.app.inject({ url: '/api/candles?id=mt5sim:WIN$N&tf=1w&limit=20' })
    ).json<CandlesResponse>();
    expect(win.meta.market).toBe('b3');
    expect(win.meta.volume).toBe('complete');
    expect(win.meta.pointValue).toBeCloseTo(0.2);
    expect(win.candles.length).toBeGreaterThanOrEqual(19);
    expect(new Date(win.candles.at(-1)?.time ?? 0).getUTCDay()).toBe(1); // semana na segunda

    // tempo real: assinatura no hub vira pedido ao agente e o candle chega em segundos
    const msgs: ServerMessage[] = [];
    const off = t.hub.subscribe('mt5sim:EURUSD', '1m', (m) => msgs.push(m));
    cleanup.push(async () => off());
    const live = await until(async () =>
      msgs.find((m) => m.type === 'candle' && m.id === 'mt5sim:EURUSD'),
    );
    expect(live.type).toBe('candle');

    const agents = (await t.app.inject({ url: '/api/mt5/agents' })).json<{
      agents: Mt5AgentStatus[];
    }>().agents;
    expect(agents[0]).toMatchObject({ online: true, mode: 'simulated' });
    expect(agents[0]?.company).toContain('SIMULADOS');
    expect(agents[0]?.symbols).toEqual(['EURUSD', 'WIN$N']);

    // o PC "desliga": o gráfico continua com o cache, com erro e a data do último dado válido
    agent.child.kill();
    await agent.done;
    skew.ms = 120_000;
    const off2 = (
      await t.app.inject({ url: '/api/candles?id=mt5sim:EURUSD&tf=5m&limit=100' })
    ).json<CandlesResponse>();
    expect(off2.status.state).toBe('error');
    expect(off2.status.message).toContain('sem contato');
    expect(off2.status.lastValidAt).toBeGreaterThan(0);
    expect(off2.candles.length).toBe(100);
    expect(agent.out()).toContain('DADOS SIMULADOS');
  }, 90_000);

  it('Radar de produção (sem RADAR_SIMULATED) recusa o simulador; --check funciona', async () => {
    const { url, token } = await server(false);
    const sim = runAgent(['--simulate', '--url', url, '--token', token, '--duration', '20']);
    expect(await sim.done).toBe(3);
    expect(sim.out()).toContain('recusa DADOS SIMULADOS');
    const check = runAgent(['--check', '--url', url, '--token', token]);
    expect(await check.done).toBe(0);
    expect(check.out()).toContain('Conexão com o Radar OK');
    const bad = runAgent([
      '--check',
      '--url',
      url,
      '--token',
      'rmt5_tokenerrado123',
      '--symbols',
      'X',
    ]);
    expect(await bad.done).toBe(1);
    expect(bad.out()).toContain('inválido ou revogado');
  }, 60_000);
});
