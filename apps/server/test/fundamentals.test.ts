import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BcbClient, CvmClient, SecEdgarClient } from '@radar/data';
import { DISTORTION_FILTERS, type Candle, type LabRun, type ScanSnapshot } from '@radar/shared';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { FUNDAMENTALS_RETRY_MS } from '../src/fundamentals/service';
import { testApp } from './helpers';

/**
 * Fundamentos no servidor (ADR-0024) com as fixtures FICTÍCIAS de packages/data (SEC e CVM), sem rede.
 */
let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const DAY = 86_400_000;
const D = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const FIX = fileURLToPath(new URL('../../../packages/data/fixtures/', import.meta.url));
const json = (name: string) => JSON.parse(readFileSync(`${FIX}${name}`, 'utf8')) as unknown;
const latin1 = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const cvmFile = (name: string) => latin1(readFileSync(`${FIX}cvm/${name}`, 'utf8'));
const dfpZip = (y: number) =>
  zipSync({
    [`dfp_cia_aberta_${y}.csv`]: cvmFile(`dfp_cia_aberta_${y}.csv`),
    [`dfp_cia_aberta_DRE_con_${y}.csv`]: cvmFile(`dfp_cia_aberta_DRE_con_${y}.csv`),
    [`dfp_cia_aberta_DRE_ind_${y}.csv`]: cvmFile(`dfp_cia_aberta_DRE_ind_${y}.csv`),
  });

/** Fontes falsas: cada rota devolve bytes, JSON ou um código de erro; `down` derruba tudo. */
function fakeSources() {
  const calls: string[] = [];
  const state = { down: false };
  const routes: Record<string, () => Uint8Array | unknown> = {
    '/files/company_tickers.json': () => json('sec-company-tickers.json'),
    '/companyfacts/CIK0009990001.json': () => json('sec-companyfacts-ficticia.json'),
    '/dfp_cia_aberta_2024.zip': () => dfpZip(2024),
    '/dfp_cia_aberta_2025.zip': () => dfpZip(2025),
    '/fca_cia_aberta_2026.zip': () =>
      zipSync({
        'fca_cia_aberta_valor_mobiliario_2026.csv': cvmFile(
          'fca_cia_aberta_valor_mobiliario_2026.csv',
        ),
      }),
  };
  const fetch = async (url: string) => {
    calls.push(url);
    if (state.down) return new Response('fora do ar', { status: 503 });
    const r = Object.entries(routes).find(([k]) => url.endsWith(k))?.[1];
    if (!r) return new Response('não encontrado', { status: 404 });
    const body = r();
    return body instanceof Uint8Array
      ? new Response(new Blob([new Uint8Array(body)]))
      : Response.json(body);
  };
  const sleep = async () => {};
  return {
    calls,
    state,
    sec: new SecEdgarClient({ userAgent: 'Radar teste contato@exemplo.com', fetch, sleep }),
    cvm: new CvmClient({ fetch, sleep }),
  };
}

const NOW = D('2026-10-13') + 15 * 3600_000;
/** Banco Central falso e vazio (o laboratório só precisa não esperar a rede). */
const noCdi = new BcbClient({ retries: 0, fetch: async () => Response.json([]) });

async function setup(patch: { market: 'us' | 'b3' | 'crypto'; symbol: string }, now = { t: NOW }) {
  const src = fakeSources();
  const t = await testApp({ now: () => now.t, sec: src.sec, cvm: src.cvm, bcb: noCdi });
  close = () => t.app.close();
  t.fake.metaPatch = { market: patch.market, symbol: patch.symbol };
  const get = async (symbolId: string) => {
    const r = await t.app.inject({ url: `/api/fundamentals?symbolId=${symbolId}` });
    expect(r.statusCode).toBe(200);
    return r.json() as { fundamentals: Record<string, unknown> | null };
  };
  return { t, src, get, now };
}

describe('FundamentalsService: SEC EDGAR (EUA)', () => {
  it('ticker → CIK → companyfacts; cache longo (não chama de novo no mesmo dia)', async () => {
    const { src, get, now } = await setup({ market: 'us', symbol: 'FICTA' });
    const { fundamentals: f } = await get('fake:FICTA');
    expect(f).toMatchObject({
      epsGrowth2y: 0.2,
      revenueNoDecline: true,
      source: 'SEC EDGAR',
      periodEnd: D('2025-12-31'),
      filedAt: D('2026-02-13'),
    });
    expect(src.calls).toHaveLength(2);
    await get('fake:FICTA');
    expect(src.calls).toHaveLength(2);
    // depois da validade (7 dias) busca de novo
    now.t += 8 * DAY;
    await get('fake:FICTA');
    expect(src.calls).toHaveLength(4);
  });

  it('fonte fora do ar com dado guardado: usa o guardado e diz o erro e a data do último dado válido', async () => {
    const { src, get, now } = await setup({ market: 'us', symbol: 'FICTA' });
    await get('fake:FICTA');
    now.t += 8 * DAY;
    src.state.down = true;
    const { fundamentals: f } = await get('fake:FICTA');
    expect(f).toMatchObject({ epsGrowth2y: 0.2, revenueNoDecline: true });
    expect((f!.notes as string[]).join(' ')).toMatch(
      /SEC EDGAR indisponível agora \(.*HTTP 503.*\); usando os dados guardados em 13\/10\/2026 12:00 \(último dado válido\)/,
    );
    // depois do erro, espera antes de tentar de novo
    const n = src.calls.length;
    now.t += FUNDAMENTALS_RETRY_MS / 2;
    await get('fake:FICTA');
    expect(src.calls.length).toBe(n);
  });

  it('fonte fora do ar sem nada guardado: não verificado, com o motivo (nunca inventa)', async () => {
    const { src, get } = await setup({ market: 'us', symbol: 'FICTA' });
    src.state.down = true;
    const { fundamentals: f } = await get('fake:FICTA');
    expect(f).toMatchObject({ epsGrowth2y: null, revenueNoDecline: null, source: 'SEC EDGAR' });
    expect((f!.notes as string[])[0]).toMatch(/indisponível: .*Sem dado guardado/);
  });

  it('ticker fora do cadastro da SEC (ex.: ETF): não verificado, com o motivo', async () => {
    const { get } = await setup({ market: 'us', symbol: 'SPYX' });
    const { fundamentals: f } = await get('fake:SPYX');
    expect(f).toMatchObject({ epsGrowth2y: null, revenueNoDecline: null });
    expect((f!.notes as string[])[0]).toMatch(/SPYX não está no cadastro de tickers da SEC/);
  });

  it('sem SEC_USER_AGENT: não chama a SEC e explica como configurar', async () => {
    const src = fakeSources();
    const t = await testApp({ now: NOW, sec: new SecEdgarClient({}), cvm: src.cvm });
    close = () => t.app.close();
    t.fake.metaPatch = { market: 'us', symbol: 'FICTA' };
    const f = await t.fundamentals.forSymbol(await t.market.getMeta('fake:FICTA'));
    expect(f?.epsGrowth2y).toBeNull();
    expect(f?.notes?.[0]).toMatch(/SEC_USER_AGENT/);
  });
});

describe('FundamentalsService: CVM (B3)', () => {
  it('FCA (ticker → CNPJ) + DFPs dos últimos anos; ano ainda não publicado (404) não é erro', async () => {
    const { src, get, t } = await setup({ market: 'b3', symbol: 'FICT3' });
    const { fundamentals: f } = await get('fake:FICT3');
    expect(f).toMatchObject({
      epsGrowth2y: 0.2,
      revenueNoDecline: true,
      source: 'CVM (DFP)',
      periodEnd: D('2025-12-31'),
      filedAt: D('2026-03-20'),
    });
    expect(f!.notes).toBeUndefined();
    expect(src.calls.map((u) => u.split('/').at(-1))).toEqual([
      'fca_cia_aberta_2026.zip',
      'dfp_cia_aberta_2023.zip',
      'dfp_cia_aberta_2024.zip',
      'dfp_cia_aberta_2025.zip',
      'dfp_cia_aberta_2026.zip',
    ]);
    // outro ticker da mesma leva usa o que já foi baixado (o zip traz todas as companhias)
    const n = src.calls.length;
    t.fake.metaPatch = { market: 'b3', symbol: 'BETA4' };
    expect((await get('fake:BETA4')).fundamentals).toMatchObject({ epsNegative: true });
    expect(src.calls.length).toBe(n);
  });

  it('banco com prejuízo e units: LPA negativo reprova; unit sem LPA por classe', async () => {
    const { get, t } = await setup({ market: 'b3', symbol: 'BETA4' });
    const { fundamentals: beta } = await get('fake:BETA4');
    expect(beta).toMatchObject({ epsNegative: true, epsGrowth2y: null, revenueNoDecline: false });
    expect((beta!.notes as string[])[0]).toMatch(/Receitas da Intermediação Financeira/);
    t.fake.metaPatch = { market: 'b3', symbol: 'GAMA11' };
    const unit = await t.fundamentals.forSymbol(await t.market.getMeta('fake:GAMA11'));
    expect(unit?.notes?.[0]).toMatch(/units juntam ações ON e PN/);
  });

  it('fracionário (FICT3F) usa o ticker do lote padrão', async () => {
    const { get } = await setup({ market: 'b3', symbol: 'FICT3F' });
    expect((await get('fake:FICT3F')).fundamentals).toMatchObject({ epsGrowth2y: 0.2 });
  });

  it('cripto e dados simulados: sem fonte de fundamentos (null)', async () => {
    const { get, t, src } = await setup({ market: 'crypto', symbol: 'AAA' });
    expect((await get('fake:AAA')).fundamentals).toBeNull();
    t.fake.metaPatch = { market: 'b3', symbol: 'SIMX', delay: { kind: 'simulated' } };
    expect(await t.fundamentals.forSymbol(await t.market.getMeta('fake:SIMX'))).toBeNull();
    expect(src.calls).toEqual([]);
  });

  it('a rota exige login', async () => {
    const src = fakeSources();
    const t = await testApp({ now: NOW, auth: true, sec: src.sec, cvm: src.cvm });
    close = () => t.app.close();
    const r = await t.app.inject({ url: '/api/fundamentals?symbolId=fake:AAA' });
    expect(r.statusCode).toBe(401);
  });
});

// ------------------------------------------------------------------ scanner, laboratório, alertas

/** 300 dias em torno de 100 e depois 400 dias caindo até 30 (médias semanais descendo). */
function longDrop(t0: number): Candle[] {
  return Array.from({ length: 700 }, (_, i) => {
    const c = i < 300 ? 100 + (i % 2 ? 0.5 : -0.5) : 100 - ((i - 299) * 70) / 400;
    const o = i < 300 ? 100 : c + 70 / 400;
    return {
      time: t0 + i * DAY,
      open: o,
      high: Math.max(o, c) + 0.5,
      low: Math.min(o, c) - 0.5,
      close: c,
      volume: 1000,
    };
  });
}

describe('fundamentos ligados no scanner, no laboratório e nos alertas', () => {
  it('scanner: "Distorção (reflexividade)" passa inteiro com LPA +20% a.a. e receita sem queda', async () => {
    const t0 = D('2026-10-13') - 700 * DAY;
    const { t } = await setup({ market: 'us', symbol: 'FICTA' });
    t.fake.candles = longDrop(t0);
    const list = (
      await t.app.inject({
        method: 'POST',
        url: '/api/watchlists',
        payload: { name: 'EUA', items: ['fake:FICTA'] },
      })
    ).json() as { id: number };
    await t.app.inject({
      method: 'POST',
      url: '/api/scanner/run',
      payload: {
        universe: { kind: 'watchlist', id: list.id },
        tf: '1d',
        filters: DISTORTION_FILTERS,
      },
    });
    await t.scanner.idle();
    const snap = (await t.app.inject({ url: '/api/scanner/adhoc' })).json() as {
      snapshot: ScanSnapshot;
    };
    const row = snap.snapshot.rows[0]!;
    expect(row.analysis!.fundamentals).toMatchObject({ epsGrowth2y: 0.2, revenueNoDecline: true });
    expect(row.filter).toMatchObject({ pass: true, chartOnly: false });
  });

  it('laboratório: reflexividade com fundamentos ponto a ponto (sem look-ahead) e o aviso', async () => {
    const { t } = await setup({ market: 'us', symbol: 'FICTA' });
    t.fake.candles = longDrop(D('2024-01-01'));
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/lab/run',
      payload: {
        symbolId: 'fake:FICTA',
        tf: '1d',
        bars: 700,
        setups: ['reflexivity'],
        capital: 10_000,
        riskPct: 1,
      },
    });
    expect(r.statusCode).toBe(200);
    const run = r.json() as LabRun;
    expect(run.dataNotes.join(' ')).toMatch(
      /Fundamentos ponto a ponto: em cada candle, só balanços publicados ANTES dele.*Primeiro balanço com data: 20\/02\/2018/,
    );
  });

  it('laboratório: ativo sem fonte de fundamentos testa só a parte gráfica e diz isso', async () => {
    const { t } = await setup({ market: 'crypto', symbol: 'AAA' });
    t.fake.candles = longDrop(D('2024-01-01'));
    const run = (
      await t.app.inject({
        method: 'POST',
        url: '/api/lab/run',
        payload: {
          symbolId: 'fake:AAA',
          tf: '1d',
          bars: 700,
          setups: ['reflexivity'],
          capital: 10_000,
          riskPct: 1,
        },
      })
    ).json() as LabRun;
    expect(run.dataNotes.join(' ')).toMatch(/testada só na parte gráfica/);
  });

  it('alertas: série com alerta de reflexividade busca os fundamentos ao ligar', async () => {
    const { t, src } = await setup({ market: 'us', symbol: 'FICTA' });
    t.fake.candles = longDrop(D('2024-01-01'));
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/alerts',
      payload: {
        symbolId: 'fake:FICTA',
        tf: '1d',
        condition: { kind: 'setup', setups: ['reflexivity'] },
        trigger: 'close',
        channels: ['push'],
      },
    });
    expect(r.statusCode).toBe(200);
    for (let i = 0; i < 50 && src.calls.length < 2; i++)
      await new Promise((ok) => setTimeout(ok, 10));
    expect(src.calls.some((u) => u.includes('companyfacts'))).toBe(true);
  });
});
