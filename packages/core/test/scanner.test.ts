import type { Candle, ScanAnalysis, ScanFilters, Session } from '@radar/shared';
import { DISTORTION_FILTERS, scanFiltersSchema } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETUP_PARAMS as DEFAULT,
  SeriesBuffer,
  applyFilters,
  closedCandles,
  drawdownFromPeak,
  scanSymbol,
  slopeDir,
  weeklyFromDaily,
} from '../src';
import { Bars, DAY, T0 } from './setups/helpers';

const WEEK = 7 * DAY;
/** Segunda-feira 06/01/2020 (meia-noite UTC), início das séries semanais. */
const W0 = Date.UTC(2020, 0, 6);

/**
 * Subida em zigue-zague: 4 candles de +2 e 3 de −1,5 (amplitude 1). O 3º candle de queda faz a menor
 * mínima com folga dos dois anteriores, então topos e fundos se confirmam ascendentes.
 */
function zigzagUp(n: number, start = 100): Bars {
  const b = new Bars();
  let p = start;
  for (let i = 0; i < n; i++) {
    p += i % 7 < 4 ? 2 : -1.5;
    b.to(p);
  }
  return b;
}

/** Semanal: `flat` semanas em torno de 100 e depois `down` semanas caindo `step` por semana. */
function weeklyDrop(flat: number, down: number, step: number): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < flat + down; i++) {
    const o = p;
    if (i >= flat) p -= step;
    out.push({
      time: W0 + i * WEEK,
      open: o,
      high: Math.max(o, p) + 0.5,
      low: Math.min(o, p) - 0.5,
      close: p,
      volume: 1000,
    });
  }
  return out;
}

const scan = (candles: readonly Candle[], extra: Partial<Parameters<typeof scanSymbol>[0]> = {}) =>
  scanSymbol({ candles, tf: '1d', tz: 'UTC', tick: 0.01, ...extra })!;

describe('scanSymbol (SPEC §14) — candles feitos à mão', () => {
  it('subida em zigue-zague: tendência de alta, médias subindo, último fechamento e horário', () => {
    const b = zigzagUp(260);
    const a = scan(b.list);
    expect(a.lastClose).toBe(b.last.close);
    expect(a.lastTime).toBe(b.last.time);
    expect(a.bars).toBe(260);
    expect(a.trend).toBe('alta');
    expect(a.adx).toBeGreaterThan(20);
    expect(a.slopes).toEqual({
      ema9: 'subindo',
      ema21: 'subindo',
      sma50: 'subindo',
      sma200: 'subindo',
    });
    // a série é longa o bastante para a MMA200 (205 candles com a inclinação), não para o semanal
    expect(a.weekly).toBeNull();
    expect(a.drawdown.w52).toBeNull();
    expect(a.spark).toHaveLength(60);
    expect(a.spark.at(-1)).toBe(b.last.close);
    expect(a.fundamentals).toBeNull();
  });

  it('borda: com poucos candles a MMA200 e a tendência ficam sem dado (nunca inventa)', () => {
    // a inclinação da MMA50 precisa de 50 + 5 candles: com 54 ainda não existe; com 55, sim
    const a = scan(zigzagUp(54).list);
    expect(a.slopes.sma200).toBeNull();
    expect(a.slopes.sma50).toBeNull();
    expect(a.slopes.ema21).toBe('subindo');
    expect(a.trend).toBe('indefinida');
    expect(scan(zigzagUp(55).list).slopes.sma50).toBe('subindo');
  });

  it('lateral perfeita: médias planas', () => {
    const b = new Bars();
    for (let i = 0; i < 230; i++) b.to(i % 2 ? 101 : 100, { open: i % 2 ? 100 : 101 });
    const a = scan(b.list);
    expect(a.slopes).toEqual({ ema9: 'plana', ema21: 'plana', sma50: 'plana', sma200: 'plana' });
    expect(a.trend).toBe('lateral');
  });

  it('semanal em queda: MME21 e MMA50 semanais descendo e queda desde o topo de 52 semanas', () => {
    const w = weeklyDrop(15, 45, 1.5);
    const a = scanSymbol({ candles: w, tf: '1w', tz: 'UTC', tick: 0.01 })!;
    expect(a.weekly).toEqual({
      bars: 60,
      lastTime: w.at(-1)!.time,
      slopes: { ema21: 'descendo', sma50: 'descendo' },
    });
    // topo das últimas 52 semanas = 100,5 (semanas planas 8 a 14); fechamento 32,5
    expect(a.drawdown.w52).toBeCloseTo(1 - 32.5 / 100.5, 12);
    expect(a.drawdown.tf).toBe(a.drawdown.w52); // no semanal as duas réguas são a mesma
  });

  it('diário com semanal à parte: as inclinações semanais vêm só do semanal recebido', () => {
    const w = weeklyDrop(15, 45, 1.5);
    const a = scan(zigzagUp(80).list, { weekly: w });
    expect(a.slopes.ema21).toBe('subindo');
    expect(a.weekly?.slopes).toEqual({ ema21: 'descendo', sma50: 'descendo' });
    // semanal curto: sem MMA50 semanal e sem topo de 52 semanas
    const short = scan(zigzagUp(80).list, { weekly: w.slice(0, 30) });
    expect(short.weekly?.slopes.sma50).toBeNull();
    expect(short.drawdown.w52).toBeNull();
  });

  it('queda desde o topo: exatamente 52 candles; com 51, sem dado', () => {
    const c = (high: number, close: number, i: number): Candle => ({
      time: T0 + i * DAY,
      open: close,
      high,
      low: close - 1,
      close,
      volume: 1,
    });
    const list = Array.from({ length: 52 }, (_, i) => c(i === 3 ? 200 : 110, 100, i));
    expect(drawdownFromPeak(list, 52)).toBe(0.5);
    expect(drawdownFromPeak(list.slice(1), 52)).toBeNull();
    // o topo mais antigo que 52 candles não conta
    const flat = Array.from({ length: 52 }, (_, i) => c(110, 100, i));
    expect(drawdownFromPeak([c(500, 100, -1), ...flat], 52)).toBeCloseTo(1 - 100 / 110, 12);
  });

  it('volume relativo = último ÷ média dos 21 anteriores; sem volume = null', () => {
    const b = zigzagUp(40);
    b.to(b.last.close + 1, { v: 3000 });
    expect(scan(b.list).relVolume).toBe(3);
    expect(scan(b.list, { volume: 'none' }).relVolume).toBeNull();
    const zero = b.list.map((c) => ({ ...c, volume: 0 }));
    expect(scan(zero).relVolume).toBeNull();
  });

  it('setups ATIVOS saem do mesmo motor: elástico armado com gatilho e stop', () => {
    // lateral estreita e um candle que FECHA abaixo da Bollinger 20/3 (como em fix-elastico)
    const b = new Bars();
    for (let i = 0; i < 40; i++) {
      const c = i % 2 ? 100.5 : 99.5;
      b.add(c === 100.5 ? 99.5 : 100.5, Math.max(c, 100) + 0.3, Math.min(c, 100) - 0.5, c);
    }
    b.add(99.5, 99.6, 96.5, 97);
    const a = scan(b.list);
    const el = a.setups.filter((s) => s.setup === 'elastic');
    expect(el).toHaveLength(1);
    expect(el[0]).toMatchObject({
      side: 'buy',
      state: 'armado',
      trigger: 99.61,
      stop: 96.49,
      againstHigher: false,
      since: b.last.time,
    });
    expect(el[0]!.reason).toBeTruthy();
    // sem o elástico ligado nos parâmetros do usuário, ele não aparece
    const off = scan(b.list, {
      params: { ...structuredClone(DEFAULT), elastic: { ...DEFAULT.elastic, enabled: false } },
    });
    expect(off.setups.some((s) => s.setup === 'elastic')).toBe(false);
  });

  it('fundamentos passam adiante como vieram (null = não verificado)', () => {
    const fu = { epsGrowth2y: 0.3, revenueNoDecline: null, source: 'teste' };
    expect(scan(zigzagUp(40).list, { fundamentals: fu }).fundamentals).toEqual(fu);
  });
});

describe('slopeDir: subindo/descendo/plana pela inclinação ÷ ATR e pa.flatSlope', () => {
  // 20 candles sem gaps com amplitude 1: ATR14 = 1 exato, então inclinação = MA[t] − MA[t−5]
  const s = new SeriesBuffer();
  for (let i = 0; i < 20; i++)
    s.push({ time: T0 + i * DAY, open: 10, high: 10.5, low: 9.5, close: 10, volume: 1 });
  const pa = { ...DEFAULT.pa, flatSlope: 0.25 };
  const ma = (delta: number) =>
    Array.from({ length: 20 }, (_, i) => (i === 19 ? 100 + delta : 100));
  it('borda: |inclinação| igual ao limite já não é plana', () => {
    expect(slopeDir(s, ma(0.25), 19, pa)).toBe('subindo');
    expect(slopeDir(s, ma(-0.25), 19, pa)).toBe('descendo');
    expect(slopeDir(s, ma(0.125), 19, pa)).toBe('plana');
    expect(slopeDir(s, ma(0), 19, { ...pa, flatSlope: 0 })).toBe('plana');
  });
  it('sem média ou sem ATR: sem dado', () => {
    const gap = ma(1);
    gap[14] = Number.NaN; // média inexistente em t − 5
    expect(slopeDir(s, gap, 19, pa)).toBeNull();
    expect(slopeDir(s, ma(1), 4, pa)).toBeNull(); // t − 5 não existe
    expect(slopeDir(s, ma(1), 10, pa)).toBeNull(); // ATR14 ainda não existe
  });
});

describe('sem look-ahead no scanner', () => {
  const session: Session = { timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6] };

  it('mexer no candle em formação e nos futuros não muda a linha', () => {
    const H = 3_600_000;
    const base = zigzagUp(300).list.map((c, i) => ({ ...c, time: T0 + i * H }));
    const k = 250; // o candle k está em formação
    const now = base[k]!.time + 30 * 60_000;
    const changed = base.map((c, i) =>
      i < k
        ? c
        : {
            ...c,
            open: c.open * 3,
            high: c.high * 4,
            low: c.low * 0.5,
            close: c.close * 2,
            volume: 99,
          },
    );
    const row = (list: Candle[]) =>
      scanSymbol({
        candles: closedCandles(list, '60m', session, now),
        tf: '60m',
        tz: 'UTC',
        tick: 0.01,
      });
    expect(row(changed)).toEqual(row(base));
    expect(row(base)!.lastTime).toBe(base[k - 1]!.time);
    // e o teste não é trivial: com o candle k fechado, a linha muda
    const later = base[k]!.time + H;
    const rowLater = (list: Candle[]) =>
      scanSymbol({
        candles: closedCandles(list, '60m', session, later),
        tf: '60m',
        tz: 'UTC',
        tick: 0.01,
      });
    expect(rowLater(changed)).not.toEqual(rowLater(base));
  });

  it('semana em andamento: candles diários dela mudam o diário, mas não o semanal', () => {
    const B3: Session = {
      timezone: 'America/Sao_Paulo',
      days: [1, 2, 3, 4, 5],
      open: '10:00',
      close: '17:00',
    };
    // 400 dias úteis até quarta 14/10/2026; "agora" = quarta 18h (diário de quarta fechado; semana não)
    const days: number[] = [];
    for (let d = Date.UTC(2026, 9, 14); days.length < 400; d -= DAY) {
      const wd = new Date(d).getUTCDay();
      if (wd !== 0 && wd !== 6) days.unshift(d);
    }
    const daily = zigzagUp(400).list.map((c, i) => ({ ...c, time: days[i]! }));
    const now = Date.UTC(2026, 9, 14, 21);
    const thisWeek = Date.UTC(2026, 9, 12);
    const changed = daily.map((c) =>
      c.time >= thisWeek ? { ...c, high: c.high * 2, close: c.close * 1.9, low: c.low } : c,
    );
    const run = (list: Candle[]) => {
      const closed = closedCandles(list, '1d', B3, now);
      return scanSymbol({
        candles: closed,
        weekly: weeklyFromDaily(closed, B3, now),
        tf: '1d',
        tz: B3.timezone,
        tick: 0.01,
      })!;
    };
    const a = run(daily);
    const b = run(changed);
    expect(b.lastClose).not.toBe(a.lastClose); // o diário de quarta já fechou
    expect(b.weekly).toEqual(a.weekly); // a semana de 12/10 ainda não
    expect(b.drawdown.w52).toBe(a.drawdown.w52);
    expect(a.weekly!.lastTime).toBe(Date.UTC(2026, 9, 5));
  });
});

/** Linha base para os testes de filtro (tudo passa até alguém mexer). */
function row(over: Partial<ScanAnalysis> = {}): ScanAnalysis {
  return {
    lastClose: 50,
    lastTime: T0,
    bars: 300,
    setups: [
      {
        setup: 's91',
        side: 'buy',
        state: 'armado',
        trigger: 51,
        stop: 48,
        target: 57,
        entry: null,
        againstHigher: false,
        since: T0,
        reason: 'MME9 virou para cima',
        notes: [],
      },
    ],
    higher: { tfLabel: 'Semanal', trend: 'alta' },
    trend: 'alta',
    adx: 25,
    respected: { ma: 'ema21', hits: 3, of: 4 },
    slopes: { ema9: 'subindo', ema21: 'subindo', sma50: 'subindo', sma200: 'plana' },
    weekly: { bars: 120, lastTime: T0, slopes: { ema21: 'descendo', sma50: 'descendo' } },
    drawdown: { tf: 0.2, w52: 0.5 },
    relVolume: 1.5,
    fundamentals: null,
    spark: [1, 2, 3],
    ...over,
  };
}

const F = (f: unknown): ScanFilters => scanFiltersSchema.parse(f);

describe('applyFilters (filtros combináveis)', () => {
  it('sem filtros, tudo passa; linha sem análise nunca passa', () => {
    expect(applyFilters(row(), {})).toMatchObject({ pass: true, chartOnly: false, reasons: [] });
    expect(applyFilters(null, {}).pass).toBe(false);
  });

  it('setup: lista, estados, lado e "fora quem vai contra a escala maior"', () => {
    expect(applyFilters(row(), F({ setup: { ids: ['s91'] } })).pass).toBe(true);
    expect(applyFilters(row(), F({ setup: { ids: ['s92', 's93'] } })).reasons[0]).toMatch(
      /nenhum Setup 9.2, Setup 9.3 ativo/,
    );
    expect(applyFilters(row(), F({ setup: { ids: ['s91'], states: ['acionado'] } })).pass).toBe(
      false,
    );
    expect(applyFilters(row(), F({ setup: { ids: ['s91'], side: 'sell' } })).pass).toBe(false);
    const contra = row({ setups: [{ ...row().setups[0]!, againstHigher: true }] });
    expect(applyFilters(contra, F({ setup: { ids: ['s91'] } })).pass).toBe(true);
    const out = applyFilters(contra, F({ setup: { ids: ['s91'], withHigher: true } }));
    expect(out.pass).toBe(false);
    expect(out.reasons[0]).toMatch(/contra a escala maior/);
  });

  it('ADX mínimo: borda inclusiva; sem ADX = sem dado', () => {
    expect(applyFilters(row({ adx: 25 }), { adxMin: 25 }).pass).toBe(true);
    expect(applyFilters(row({ adx: 24.99 }), { adxMin: 25 }).pass).toBe(false);
    const nd = applyFilters(row({ adx: null }), { adxMin: 0 });
    expect(nd.pass).toBe(false);
    expect(nd.checks[0]!.status).toBe('nodata');
  });

  it('tendência e média respeitada', () => {
    expect(applyFilters(row(), F({ trend: ['alta'] })).pass).toBe(true);
    expect(applyFilters(row({ trend: 'lateral' }), F({ trend: ['alta', 'baixa'] })).pass).toBe(
      false,
    );
    expect(applyFilters(row(), F({ respected: ['ema9', 'ema21'] })).pass).toBe(true);
    expect(applyFilters(row(), F({ respected: ['sma50'] })).reasons[0]).toMatch(
      /respeita a MME21, não a MMA50/,
    );
    expect(applyFilters(row({ respected: null }), F({ respected: ['ema21'] })).pass).toBe(false);
  });

  it('inclinação por escala; semanal ausente = sem dado', () => {
    const f = F({
      slopes: [
        { scale: 'tf', ma: 'sma200', dir: 'plana' },
        { scale: '1w', ma: 'sma50', dir: 'descendo' },
      ],
    });
    expect(applyFilters(row(), f).pass).toBe(true);
    expect(
      applyFilters(row({ slopes: { ...row().slopes, sma200: 'subindo' } }), f).reasons,
    ).toEqual(['MMA200 subindo (pedido: plana)']);
    const nd = applyFilters(row({ weekly: null }), f);
    expect(nd.checks.find((c) => c.key === 'slope:1w:sma50')).toMatchObject({
      status: 'nodata',
      detail: 'MMA50 semanal: sem candles semanais',
    });
    // a mesma média duas vezes na mesma escala é recusada
    expect(
      scanFiltersSchema.safeParse({
        slopes: [
          { scale: 'tf', ma: 'ema9', dir: 'subindo' },
          { scale: 'tf', ma: 'ema9', dir: 'plana' },
        ],
      }).success,
    ).toBe(false);
  });

  it('queda mínima (borda inclusiva) e volume relativo', () => {
    expect(applyFilters(row(), { minDrawdown: { ref: '52w', value: 0.5 } }).pass).toBe(true);
    expect(applyFilters(row(), { minDrawdown: { ref: 'tf', value: 0.5 } }).pass).toBe(false);
    expect(
      applyFilters(row({ drawdown: { tf: null, w52: null } }), {
        minDrawdown: { ref: 'tf', value: 0.1 },
      }).checks[0]!.status,
    ).toBe('nodata');
    expect(applyFilters(row(), { minRelVolume: 1.5 }).pass).toBe(true);
    expect(applyFilters(row({ relVolume: null }), { minRelVolume: 0 }).reasons).toEqual([
      'sem dado de volume',
    ]);
  });

  it('fundamentos sem dado: não passa e o motivo diz "fundamentos não verificados"', () => {
    const f = F({ fundamentals: { minEpsGrowth: 0.2, revenueNoDecline: true } });
    const out = applyFilters(row(), f);
    expect(out.pass).toBe(false);
    expect(out.chartOnly).toBe(true);
    expect(out.reasons).toHaveLength(2);
    for (const r of out.reasons) expect(r).toMatch(/fundamentos não verificados/);
    // só parte verificada: LPA bom, receita sem dado
    const part = applyFilters(
      row({ fundamentals: { epsGrowth2y: 0.25, revenueNoDecline: null, source: 'SEC' } }),
      f,
    );
    expect(part).toMatchObject({ pass: false, chartOnly: true });
    expect(part.reasons).toEqual(['fundamentos não verificados: SEC sem dado de receita']);
    // dado conhecido e fraco: reprova de verdade (não é "só gráfico")
    const weak = applyFilters(
      row({ fundamentals: { epsGrowth2y: 0.1, revenueNoDecline: true, source: 'SEC' } }),
      f,
    );
    expect(weak).toMatchObject({ pass: false, chartOnly: false });
    expect(
      applyFilters(
        row({ fundamentals: { epsGrowth2y: 0.2, revenueNoDecline: true, source: 'SEC' } }),
        f,
      ).pass,
    ).toBe(true);
  });

  it('"Distorção (reflexividade)": hoje, sem fonte de fundamentos, só passa na parte gráfica', () => {
    const out = applyFilters(row(), DISTORTION_FILTERS);
    expect(out).toMatchObject({ pass: false, chartOnly: true });
    expect(out.checks.map((c) => `${c.key}:${c.status}`)).toEqual([
      'slope:1w:ema21:ok',
      'slope:1w:sma50:ok',
      'drawdown:ok',
      'eps:unverified',
    ]);
    // queda de 49%: nem a parte gráfica passa
    const small = applyFilters(row({ drawdown: { tf: 0.2, w52: 0.49 } }), DISTORTION_FILTERS);
    expect(small.chartOnly).toBe(false);
    // média semanal só plana (sem descer): também não
    const flat = row({
      weekly: { bars: 120, lastTime: T0, slopes: { ema21: 'plana', sma50: 'descendo' } },
    });
    expect(applyFilters(flat, DISTORTION_FILTERS).chartOnly).toBe(false);
    // com fundamentos verificados e fortes, passa inteiro
    const strong = row({
      fundamentals: { epsGrowth2y: 0.35, revenueNoDecline: true, source: 'SEC' },
    });
    expect(applyFilters(strong, DISTORTION_FILTERS).pass).toBe(true);
  });

  it('o filtro pronto é válido pelo schema', () => {
    expect(scanFiltersSchema.parse(DISTORTION_FILTERS)).toEqual(DISTORTION_FILTERS);
  });
});
