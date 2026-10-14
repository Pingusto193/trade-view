import { marketState } from '@radar/core';
import {
  mt5IngestSchema,
  type Candle,
  type FeedStatus,
  type Mt5IngestInput,
  type Mt5Rate,
  type Mt5SymbolInfo,
} from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  DataSourceError,
  Mt5Adapter,
  SymbolNotFoundError,
  buildMt5Meta,
  clockOffsetMin,
  forexSession,
  inferMt5Market,
  isB3Future,
  mt5RatesToCandles,
  parseServerTz,
  resolveClock,
  serverWallToUtc,
  type CandleUpdate,
  type Mt5Clock,
  type Mt5Store,
  type Mt5SymbolRecord,
} from '../src';

const MIN = 60_000;
const H = 60 * MIN;
const WINTER = Date.UTC(2026, 0, 14, 15, 0); // quarta, Nova York em EST (UTC−5)
const SUMMER = Date.UTC(2026, 6, 15, 15, 0); // quarta, Nova York em EDT (UTC−4)
const NY7: Mt5Clock = { kind: 'zone', tz: 'America/New_York', shiftMin: 420 };

function info(over: Partial<Mt5SymbolInfo> & { name: string }): Mt5SymbolInfo {
  return {
    description: '',
    path: '',
    exchange: '',
    currency_base: '',
    currency_profit: '',
    digits: 5,
    point: 0.00001,
    trade_tick_size: 0,
    trade_tick_value: 0,
    trade_contract_size: 0,
    volume_min: 0,
    volume_step: 0,
    trade_calc_mode: -1,
    market: 'auto',
    ...over,
  };
}

const EURUSD = info({
  name: 'EURUSD',
  description: 'Euro vs US Dollar',
  path: 'Forex\\Majors\\EURUSD',
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
});
const WIN = info({
  name: 'WIN$N',
  description: 'Mini Índice (contínuo)',
  path: 'BMF\\WIN$N',
  currency_profit: 'BRL',
  digits: 0,
  point: 1,
  trade_tick_size: 5,
  trade_tick_value: 1,
  trade_contract_size: 1,
  volume_min: 1,
  volume_step: 1,
  trade_calc_mode: 33,
});
const WDO = info({
  ...WIN,
  name: 'WDO$N',
  description: 'Mini Dólar',
  digits: 1,
  point: 0.5,
  trade_tick_size: 0.5,
  trade_tick_value: 5,
});
const PETR4 = info({
  name: 'PETR4',
  description: 'PETROBRAS PN',
  path: 'BOVESPA\\A VISTA\\PETR4',
  currency_profit: 'BRL',
  digits: 2,
  point: 0.01,
  trade_tick_size: 0.01,
  trade_tick_value: 0.01,
  trade_contract_size: 1,
  volume_min: 100,
  volume_step: 100,
  trade_calc_mode: 32,
});

/** Barra crua no relógio do servidor (wallMs = horário de parede, como se fosse UTC). */
function rate(wallMs: number, close: number, tickVol = 10, realVol = 0): Mt5Rate {
  return [wallMs / 1000, close, close + 0.0005, close - 0.0005, close, tickVol, 1, realVol];
}

function msg(over: Partial<Mt5IngestInput> = {}, agent: Partial<Mt5IngestInput['agent']> = {}) {
  return mt5IngestSchema.parse({
    protocol: 1,
    agent: {
      version: '1.0',
      mode: 'mt5',
      terminalConnected: true,
      company: 'Corretora X',
      ...agent,
    },
    ...over,
  });
}

const TOKEN = { id: 1, name: 'PC de casa' };

function setup(now: { t: number }, opts: { staleMs?: number; historyTimeoutMs?: number } = {}) {
  return new Mt5Adapter({ now: () => now.t, ...opts });
}

function handlers() {
  const candles: CandleUpdate[] = [];
  const statuses: FeedStatus[] = [];
  let reconnects = 0;
  return {
    candles,
    statuses,
    get reconnects() {
      return reconnects;
    },
    h: {
      onCandle: (u: CandleUpdate) => candles.push(u),
      onStatus: (s: FeedStatus) => statuses.push(s),
      onReconnect: () => void reconnects++,
    },
  };
}

/** Deixa as promessas pendentes andarem (getCandles registra o pedido de histórico). */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('relógio do servidor MT5', () => {
  it('lê os formatos de server_timezone', () => {
    expect(parseServerTz('auto')).toBe('auto');
    expect(parseServerTz('')).toBe('auto');
    expect(parseServerTz('NY+7')).toEqual(NY7);
    expect(parseServerTz('UTC')).toEqual({ kind: 'fixed', offsetMin: 0 });
    expect(parseServerTz('UTC+02:00')).toEqual({ kind: 'fixed', offsetMin: 120 });
    expect(parseServerTz('GMT-3')).toEqual({ kind: 'fixed', offsetMin: -180 });
    expect(parseServerTz('UTC+5:30')).toEqual({ kind: 'fixed', offsetMin: 330 });
    expect(parseServerTz('America/Sao_Paulo')).toEqual({
      kind: 'zone',
      tz: 'America/Sao_Paulo',
      shiftMin: 0,
    });
    expect(parseServerTz('Marte/Olimpo')).toBeNull();
    expect(parseServerTz('UTC+20')).toBeNull();
  });

  it('NY+7 segue o horário de verão dos EUA (UTC+2 no inverno, UTC+3 no verão)', () => {
    expect(clockOffsetMin(NY7, WINTER)).toBe(120);
    expect(clockOffsetMin(NY7, SUMMER)).toBe(180);
    // 17:00 no servidor = 15:00 UTC no inverno e 14:00 UTC no verão
    expect(serverWallToUtc(WINTER + 2 * H, NY7)).toBe(WINTER);
    expect(serverWallToUtc(SUMMER + 3 * H, NY7)).toBe(SUMMER);
    expect(serverWallToUtc(WINTER, { kind: 'fixed', offsetMin: -180 })).toBe(WINTER + 3 * H);
  });

  it('configuração explícita vale, com aviso se o tick discordar', () => {
    const r = resolveClock('UTC+02:00', 180, false, WINTER);
    expect(r.source).toBe('config');
    expect(r.clock).toEqual({ kind: 'fixed', offsetMin: 120 });
    expect(r.notes.join(' ')).toContain('não bate');
    expect(resolveClock('NY+7', 120, false, WINTER).notes).toEqual([]);
  });

  it('auto: B3 com UTC−3 vira horário de Brasília; forex com a diferença de NY+7 vira NY+7', () => {
    const b3 = resolveClock('auto', -180, true, WINTER);
    expect(b3.clock).toEqual({ kind: 'zone', tz: 'America/Sao_Paulo', shiftMin: 0 });
    expect(b3.source).toBe('detected');
    const fx = resolveClock('auto', 180, false, SUMMER);
    expect(fx.clock).toEqual(NY7);
    expect(fx.notes.join(' ')).toContain('NY+7');
    const fixed = resolveClock('auto', 60, false, WINTER);
    expect(fixed.clock).toEqual({ kind: 'fixed', offsetMin: 60 });
  });

  it('auto sem medida: B3 supõe Brasília; forex avisa que o fuso é desconhecido', () => {
    expect(resolveClock('auto', null, true, WINTER).source).toBe('default-b3');
    const fx = resolveClock('auto', null, false, WINTER);
    expect(fx.source).toBe('unknown');
    expect(fx.notes.join(' ')).toContain('DESCONHECIDO');
    expect(resolveClock('lixo', null, false, WINTER).notes[0]).toContain('não foi entendido');
  });

  it('sessão do forex no relógio do servidor: NY+7 → segunda 00:00 a sábado 00:00', () => {
    const w = forexSession(NY7, WINTER);
    expect(w.exact).toBe(true);
    expect(w.session.timezone).toBe('Etc/GMT-2');
    expect(w.session.weekly).toEqual({
      openDay: 1,
      openTime: '00:00',
      closeDay: 6,
      closeTime: '00:00',
    });
    expect(forexSession(NY7, SUMMER).session.timezone).toBe('Etc/GMT-3');
    // servidor em UTC: abre domingo 21:00 UTC no verão de Nova York
    const utc = forexSession({ kind: 'fixed', offsetMin: 0 }, SUMMER).session;
    expect(utc.weekly).toMatchObject({ openDay: 0, openTime: '21:00', closeDay: 5 });
    // sábado fechado, quarta aberto
    expect(marketState(w.session, Date.UTC(2026, 0, 17, 12))).toBe('closed');
    expect(marketState(w.session, WINTER)).toBe('open');
    // domingo 23:00 UTC (18:00 em Nova York) já aberto
    expect(marketState(w.session, Date.UTC(2026, 0, 18, 23))).toBe('open');
  });
});

describe('MT5: mercado, volume e metadados', () => {
  it('deduz o mercado pelo modo de cálculo, bolsa e moeda (a configuração manda)', () => {
    expect(inferMt5Market(EURUSD)).toBe('forex');
    expect(inferMt5Market(WIN)).toBe('b3');
    expect(inferMt5Market(PETR4)).toBe('b3');
    expect(
      inferMt5Market(info({ name: 'US500', trade_calc_mode: 3, currency_profit: 'USD' })),
    ).toBe('forex');
    expect(inferMt5Market({ ...EURUSD, market: 'b3' })).toBe('b3');
    expect(isB3Future(WIN)).toBe(true);
    expect(isB3Future(PETR4)).toBe(false);
    expect(isB3Future(info({ name: 'WDOX26' }))).toBe(true);
  });

  it('converte barras: diário pela data do servidor, intradiário para UTC, volume escolhido', () => {
    const d = Date.UTC(2026, 0, 14); // D1 de 14/01 (meia-noite do servidor)
    const daily = mt5RatesToCandles([rate(d, 1.1, 500, 0)], '1d', NY7, 'tick');
    expect(daily[0]?.time).toBe(d);
    expect(daily[0]?.volume).toBe(500);
    const intra = mt5RatesToCandles([rate(WINTER + 2 * H, 1.1, 7, 99)], '5m', NY7, 'real');
    expect(intra[0]?.time).toBe(WINTER);
    expect(intra[0]?.volume).toBe(99);
    // barra inválida (máxima < mínima) é descartada
    const bad: Mt5Rate = [WINTER / 1000, 1, 0.9, 1.1, 1, 1, 0, 0];
    expect(mt5RatesToCandles([bad], '5m', NY7, 'tick')).toEqual([]);
  });

  const rec = (i: Mt5SymbolInfo, over: Partial<Mt5SymbolRecord> = {}): Mt5SymbolRecord => ({
    info: i,
    tokenId: 1,
    agentName: 'PC',
    company: 'Corretora X',
    market: inferMt5Market(i),
    volumeKind: inferMt5Market(i) === 'b3' ? 'real' : 'tick',
    clock: NY7,
    clockLabel: 'NY+7',
    clockNotes: [],
    seenAt: WINTER,
    ...over,
  });

  it('forex: tick volume com aviso claro, lotes e valor do ponto = tamanho do contrato', () => {
    const m = buildMt5Meta('mt5', 'MetaTrader 5', rec(EURUSD), false, WINTER);
    expect(m.id).toBe('mt5:EURUSD');
    expect(m.market).toBe('forex');
    expect(m.volume).toBe('tick');
    expect(m.liveVolume).toBe('tick');
    expect(m.notes.join(' ')).toContain('NÃO é volume negociado');
    expect(m.pointValue).toBe(100_000);
    expect(m.minQty).toBe(0.01);
    expect(m.lotSize).toBe(1);
    expect(m.currency).toBe('USD');
    expect(m.priceDecimals).toBe(5);
    expect(m.delay).toEqual({ kind: 'realtime' });
    expect(m.session.weekly).toBeDefined();
  });

  it('B3: mini-índice R$ 0,20/ponto, mini-dólar R$ 10/ponto, ação em lote de 100', () => {
    const win = buildMt5Meta('mt5', 'MetaTrader 5', rec(WIN), false, WINTER);
    expect(win.pointValue).toBeCloseTo(0.2);
    expect(win.tickSize).toBe(5);
    expect(win.volume).toBe('complete');
    expect(win.session.close).toBe('18:30');
    expect(buildMt5Meta('mt5', 'MT5', rec(WDO), false, WINTER).pointValue).toBe(10);
    const petr = buildMt5Meta('mt5', 'MT5', rec(PETR4), false, WINTER);
    expect(petr.pointValue).toBe(1);
    expect(petr.lotSize).toBe(100);
    expect(petr.session.timezone).toBe('America/Sao_Paulo');
    const tickOnly = buildMt5Meta('mt5', 'MT5', rec(PETR4, { volumeKind: 'tick' }), false, WINTER);
    expect(tickOnly.volume).toBe('tick');
  });

  it('simulado: faixa DADOS SIMULADOS (atraso "simulated") e nome marcado', () => {
    const m = buildMt5Meta('mt5sim', 'MT5 simulado (DEV)', rec(EURUSD), true, WINTER);
    expect(m.delay).toEqual({ kind: 'simulated' });
    expect(m.name).toContain('SIMULADO');
    expect(m.notes[0]).toContain('DADOS SIMULADOS');
  });
});

describe('Mt5Adapter (ingestão e tempo real)', () => {
  it('ativo nunca anunciado: não encontrado', async () => {
    const a = setup({ t: WINTER });
    await expect(a.getCandles({ symbol: 'EURUSD', tf: '1d' })).rejects.toBeInstanceOf(
      SymbolNotFoundError,
    );
    expect(await a.searchSymbols('EUR')).toEqual([]);
    expect(a.isConfigured()).toBe(false);
  });

  it('anúncio de ativos: aparecem na busca com o mercado certo', async () => {
    const a = setup({ t: WINTER });
    a.ingest(TOKEN, msg({ symbols: [EURUSD, WIN] }, { serverTz: 'NY+7' }));
    const r = await a.searchSymbols('eur');
    expect(r).toEqual([
      {
        id: 'mt5:EURUSD',
        symbol: 'EURUSD',
        name: 'Euro vs US Dollar',
        market: 'forex',
        sourceLabel: 'MetaTrader 5',
      },
    ]);
    expect((await a.searchSymbols('WIN'))[0]?.market).toBe('b3');
    expect(await a.searchSymbols('forex')).toHaveLength(1);
    expect(a.isConfigured()).toBe(true);
  });

  it('getCandles pede o histórico ao agente e espera a resposta', async () => {
    const now = { t: WINTER };
    const a = setup(now);
    a.ingest(TOKEN, msg({ symbols: [EURUSD] }, { serverTz: 'NY+7' }));
    const p = a.getCandles({ symbol: 'EURUSD', tf: '5m', limit: 3 });
    await tick();
    const r1 = a.ingest(TOKEN, msg({}, { serverTz: 'NY+7' }));
    expect(r1.history).toEqual([{ symbol: 'EURUSD', tf: '5m', count: 3 }]);
    const base = WINTER + 2 * H - 10 * 5 * MIN; // relógio do servidor
    const rates = Array.from({ length: 10 }, (_, i) => rate(base + i * 5 * MIN, 1.1 + i / 1000));
    const r2 = a.ingest(
      TOKEN,
      msg({ bars: [{ symbol: 'EURUSD', tf: '5m', rates, history: true }] }, { serverTz: 'NY+7' }),
    );
    expect(r2.history).toEqual([]);
    const got = await p;
    expect(got).toHaveLength(3);
    expect(got.at(-1)?.time).toBe(WINTER - 5 * MIN); // convertido para UTC
    // segunda consulta com o mesmo tamanho: sem novo pedido
    await expect(a.getCandles({ symbol: 'EURUSD', tf: '5m', limit: 3 })).resolves.toHaveLength(3);
  });

  it('histórico que não chega a tempo: erro explicado', async () => {
    const a = setup({ t: WINTER }, { historyTimeoutMs: 20 });
    a.ingest(TOKEN, msg({ symbols: [EURUSD] }));
    const err = await a.getCandles({ symbol: 'EURUSD', tf: '1d' }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(DataSourceError);
    expect((err as Error).message).toContain('a tempo');
  });

  it('assinatura: wants para o agente, candle em formação e fechado sem repetir', () => {
    const now = { t: WINTER + 2 * MIN };
    const a = setup(now);
    a.ingest(TOKEN, msg({ symbols: [EURUSD] }, { serverTz: 'NY+7' }));
    const s = handlers();
    const sub = a.subscribe('EURUSD', '1m', s.h);
    expect(s.statuses.at(-1)?.state).toBe('ok');
    const r = a.ingest(TOKEN, msg({}, { serverTz: 'NY+7' }));
    expect(r.wants).toEqual([{ symbol: 'EURUSD', tf: '1m' }]);
    const wall = (utc: number) => utc + 2 * H;
    const bars = [
      rate(wall(WINTER), 1.1),
      rate(wall(WINTER + MIN), 1.2),
      rate(wall(WINTER + 2 * MIN), 1.3),
    ];
    a.ingest(
      TOKEN,
      msg({ bars: [{ symbol: 'EURUSD', tf: '1m', rates: bars }] }, { serverTz: 'NY+7' }),
    );
    expect(s.candles.map((u) => [u.candle.time, u.closed])).toEqual([
      [WINTER, true],
      [WINTER + MIN, true],
      [WINTER + 2 * MIN, false],
    ]);
    // mesmo lote de novo: nada repetido
    a.ingest(
      TOKEN,
      msg({ bars: [{ symbol: 'EURUSD', tf: '1m', rates: bars }] }, { serverTz: 'NY+7' }),
    );
    expect(s.candles).toHaveLength(3);
    // o minuto acabou (com folga) e não veio barra nova: o candle fecha pelo relógio
    now.t = WINTER + 3 * MIN + 4_000;
    a.ingest(
      TOKEN,
      msg({ bars: [{ symbol: 'EURUSD', tf: '1m', rates: bars }] }, { serverTz: 'NY+7' }),
    );
    expect(s.candles.at(-1)).toMatchObject({ closed: true, candle: { time: WINTER + 2 * MIN } });
    sub.close();
    expect(a.ingest(TOKEN, msg()).wants).toEqual([]);
  });

  it('semanal montado do diário; barra de domingo do par de moedas vai para a semana seguinte', async () => {
    const now = { t: Date.UTC(2026, 0, 14, 12) };
    const a = setup(now);
    a.ingest(TOKEN, msg({ symbols: [EURUSD] }, { serverTz: 'UTC' }));
    const s = handlers();
    a.subscribe('EURUSD', '1w', s.h);
    expect(a.ingest(TOKEN, msg({}, { serverTz: 'UTC' })).wants).toEqual([
      { symbol: 'EURUSD', tf: '1d' },
    ]);
    const day = (d: number) => Date.UTC(2026, 0, d);
    // sex 09/01, dom 11/01 (abre a semana seguinte), seg 12/01 … qua 14/01
    const rates = [9, 11, 12, 13, 14].map((d, i) => rate(day(d), 1.1 + i / 100, 100 + i));
    const p = a.getCandles({ symbol: 'EURUSD', tf: '1w', limit: 2 });
    await tick();
    a.ingest(TOKEN, msg({}, { serverTz: 'UTC' }));
    a.ingest(
      TOKEN,
      msg({ bars: [{ symbol: 'EURUSD', tf: '1d', rates, history: true }] }, { serverTz: 'UTC' }),
    );
    const weeks = await p;
    expect(weeks.map((c) => c.time)).toEqual([day(5), day(12)]);
    expect(weeks[1]?.volume).toBe(101 + 102 + 103 + 104); // domingo + seg..qua
    // tempo real do diário chega como semana em formação
    a.ingest(
      TOKEN,
      msg({ bars: [{ symbol: 'EURUSD', tf: '1d', rates: rates.slice(-2) }] }, { serverTz: 'UTC' }),
    );
    const last = s.candles.at(-1) as CandleUpdate;
    expect(last.closed).toBe(false);
    expect(last.candle.time).toBe(day(12));
  });

  it('agente some: erro honesto com a data do último contato; volta: recarrega', async () => {
    const now = { t: WINTER };
    const a = setup(now, { staleMs: 15_000 });
    a.ingest(TOKEN, msg({ symbols: [EURUSD] }));
    const s = handlers();
    a.subscribe('EURUSD', '5m', s.h);
    now.t += 60_000;
    a.refreshStatuses();
    const st = s.statuses.at(-1) as FeedStatus;
    expect(st.state).toBe('error');
    expect(st.message).toContain('sem contato desde 14/01/2026 12:00'); // horário de Brasília
    expect(st.lastValidAt).toBe(WINTER);
    const err = await a.getCandles({ symbol: 'EURUSD', tf: '5m' }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(DataSourceError);
    expect((await a.searchSymbols('EUR'))[0]?.name).toContain('desconectado');
    // reconexão: assinantes avisados para recarregar o buraco
    a.ingest(TOKEN, msg());
    expect(s.reconnects).toBe(1);
    expect(s.statuses.at(-1)?.state).toBe('ok');
  });

  it('MT5 aberto mas sem corretora: estado de erro explicado', () => {
    const a = setup({ t: WINTER });
    a.ingest(TOKEN, msg({ symbols: [EURUSD] }));
    const s = handlers();
    a.subscribe('EURUSD', '1m', s.h);
    a.ingest(TOKEN, msg({}, { terminalConnected: false }));
    expect(s.statuses.at(-1)?.message).toContain('sem conexão com a corretora');
  });

  it('dois agentes com o mesmo ativo: o primeiro conectado fica com ele', async () => {
    const a = setup({ t: WINTER });
    a.ingest(TOKEN, msg({ symbols: [EURUSD] }));
    const r = a.ingest({ id: 2, name: 'Notebook' }, msg({ symbols: [EURUSD, WIN] }));
    expect(r.messages[0]).toContain('outro agente');
    expect(a.symbolsOf(1)).toEqual(['EURUSD']);
    expect(a.symbolsOf(2)).toEqual(['WIN$N']);
    const bars = a.ingest(
      { id: 2, name: 'Notebook' },
      msg({ bars: [{ symbol: 'EURUSD', tf: '1m', rates: [rate(WINTER, 1.1)] }] }),
    );
    expect(bars.messages[0]).toContain('não anunciado');
  });

  it('B3 sem volume real no histórico: passa a tick volume e avisa no meta', async () => {
    const a = setup({ t: WINTER });
    a.ingest(TOKEN, msg({ symbols: [PETR4] }));
    expect((await a.getMeta('PETR4')).volume).toBe('complete');
    const day = (d: number) => Date.UTC(2026, 0, d);
    const rates = Array.from({ length: 12 }, (_, i) => rate(day(1 + i), 30 + i, 50, 0));
    a.ingest(TOKEN, msg({ bars: [{ symbol: 'PETR4', tf: '1d', rates, history: true }] }));
    const m = await a.getMeta('PETR4');
    expect(m.volume).toBe('tick');
    expect(m.notes.join(' ')).toContain('não manda volume real');
  });

  it('persistência: ativos guardados reaparecem após reinício, como desconectados', async () => {
    const saved: Mt5SymbolRecord[] = [];
    const store: Mt5Store = {
      load: () => saved,
      save: (_src, r) => {
        const i = saved.findIndex((x) => x.info.name === r.info.name);
        if (i >= 0) saved[i] = r;
        else saved.push(r);
      },
    };
    const now = { t: WINTER };
    const a = setup(now);
    a.attachStore(store);
    a.ingest(TOKEN, msg({ symbols: [EURUSD] }));
    expect(saved).toHaveLength(1);
    const b = setup(now);
    b.attachStore(store);
    expect((await b.getMeta('EURUSD')).market).toBe('forex');
    expect((await b.searchSymbols('EUR'))[0]?.name).toContain('desconectado');
    await expect(b.getCandles({ symbol: 'EURUSD', tf: '1d' })).rejects.toThrow('sem contato');
  });

  it('adaptador do simulador do agente tem id e rótulo próprios', async () => {
    const a = new Mt5Adapter({ simulated: true, now: () => WINTER });
    expect(a.id).toBe('mt5sim');
    a.ingest(TOKEN, msg({ symbols: [EURUSD] }, { mode: 'simulated' }));
    const m = await a.getMeta('EURUSD');
    expect(m.id).toBe('mt5sim:EURUSD');
    expect(m.delay.kind).toBe('simulated');
    const s = handlers();
    a.subscribe('EURUSD', '1m', s.h);
    expect(s.statuses.at(-1)?.message).toContain('DADOS SIMULADOS');
  });

  it('candles devolvidos são cópias (o chamador não altera a memória)', async () => {
    const a = setup({ t: WINTER });
    a.ingest(TOKEN, msg({ symbols: [EURUSD] }));
    const p = a.getCandles({ symbol: 'EURUSD', tf: '1d', limit: 1 });
    await tick();
    a.ingest(TOKEN, msg());
    a.ingest(
      TOKEN,
      msg({
        bars: [
          { symbol: 'EURUSD', tf: '1d', rates: [rate(Date.UTC(2026, 0, 14), 1.1)], history: true },
        ],
      }),
    );
    const got = (await p) as Candle[];
    (got[0] as Candle).close = 999;
    const again = await a.getCandles({ symbol: 'EURUSD', tf: '1d', limit: 1 });
    expect(again[0]?.close).toBe(1.1);
  });
});
