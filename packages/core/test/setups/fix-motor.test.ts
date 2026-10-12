import type { Candle, Timeframe } from '@radar/shared';
import { isIntraday } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  AlertRuntime,
  DEFAULT_PA,
  DEFAULT_SETUP_PARAMS,
  PivotTracker,
  SeriesBuffer,
  SetupEngine,
  aggregate,
  computeContext,
  detectSetups,
  higherContextFn,
  periodKey,
  respectedMaAt,
  slope,
  trendSeries,
  type HigherContext,
  type SetupEvent,
  type SetupId,
  type StepContext,
} from '../../src';
import { Bars, T0, params, run } from './helpers';

const HOUR = 3_600_000;
const ALL_SETUPS: SetupId[] = [
  's91',
  's92',
  's93',
  'pullback',
  'consolidation',
  'elastic',
  'reflexivity',
];

/** Gerador determinístico (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Passeio aleatório diário com regimes (alta, baixa, lateral). */
function walk(n: number, seed: number): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const regime = Math.floor(i / 150) % 3;
    const drift = regime === 0 ? 0.004 : regime === 1 ? -0.004 : 0;
    const o = p * (1 + (r() - 0.5) * 0.01);
    const c = o * (1 + drift + (r() - 0.5) * 0.04);
    out.push({
      time: T0 + i * 86_400_000,
      open: o,
      high: Math.max(o, c) * (1 + r() * 0.012),
      low: Math.min(o, c) * (1 - r() * 0.012),
      close: c,
      volume: Math.round(1000 * (0.4 + r() * 1.5)),
    });
    p = c;
  }
  return out;
}

/** Candles de 60 min, 24 h por dia, começando à meia-noite de São Paulo (03:00 UTC). */
function hourly(days: number, seed: number): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < days * 24; i++) {
    const regime = Math.floor(i / 24 / 25) % 3;
    const drift = regime === 0 ? 0.0012 : regime === 1 ? -0.0012 : 0;
    const o = p;
    const c = o * (1 + drift + (r() - 0.5) * 0.006);
    out.push({
      time: T0 + 3 * HOUR + i * HOUR,
      open: o,
      high: Math.max(o, c) * (1 + r() * 0.002),
      low: Math.min(o, c) * (1 - r() * 0.002),
      close: c,
      volume: 100,
    });
    p = c;
  }
  return out;
}

/** Ondas diárias longas (impulso e recuo em %), que formam topos e fundos também no semanal. */
function longWaves(b: Bars, dir: 1 | -1, cycles: number): Bars {
  let c = b.n ? b.last.close : 100;
  if (!b.n) b.add(c, c * 1.005, c * 0.995, c);
  for (let k = 0; k < cycles; k++) {
    for (let i = 0; i < 30; i++) b.to((c *= 1 + dir * 0.008), { range: c * 0.01, v: 1200 });
    for (let i = 0; i < 15; i++) b.to((c *= 1 - dir * 0.009), { range: c * 0.006, v: 700 });
  }
  return b;
}

/** Tendência em ondas curtas (impulsos e recuos). */
function waves(dir: 1 | -1, cycles: number): Bars {
  const b = new Bars();
  let c = 100;
  b.add(c, c + 0.5, c - 0.5, c);
  for (let k = 0; k < cycles; k++) {
    for (let i = 0; i < 10; i++) b.to((c += dir * 1.2), { range: 1.2, v: 1200 });
    for (let i = 0; i < 5; i++) b.to((c -= dir * 1.0), { range: 0.7, v: 700 });
  }
  return b;
}

/** Alta forte com recuos rasos: o ativo respeita a MME9. */
function shallow(): Bars {
  const b = new Bars();
  let c = 100;
  b.add(c, c + 0.5, c - 0.5, c);
  for (let k = 0; k < 14; k++) {
    for (let i = 0; i < 8; i++) b.to((c += 1.5));
    for (let i = 0; i < 3; i++) b.to((c -= 1.0));
  }
  return b;
}

/**
 * Referência INDEPENDENTE da escala maior: agrega a série inteira, calcula a tendência de cada candle
 * maior e, para cada candle menor, usa o candle maior ANTERIOR ao período que o contém (já fechado).
 */
function referenceHigher(
  list: readonly Candle[],
  from: Timeframe,
  to: Timeframe,
  tz: string,
  label: string,
): (HigherContext | null)[] {
  const agg = aggregate(list, from, to, tz);
  const tr = trendSeries(agg);
  const pos = new Map(agg.map((c, i) => [c.time, i]));
  const key = periodKey(to, isIntraday(from) ? tz : 'UTC');
  return list.map((c) => {
    const j = pos.get(key(c.time)) as number;
    const x = j > 0 ? tr[j - 1] : 'indefinida';
    return !x || x === 'indefinida' ? null : { trend: x, tfLabel: label };
  });
}

/** Detector espião: registra o contexto que o motor entrega a cada candle. */
function spy(engine: SetupEngine): StepContext[] {
  const seen: StepContext[] = [];
  (engine.detectors as unknown[]).push({
    id: 'spy',
    openInstances: [],
    step: (_s: SeriesBuffer, _t: number, ctx: StepContext) => {
      seen.push({ ...ctx });
      return [];
    },
  });
  return seen;
}

const RED = /⚠ Aviso vermelho: contra a escala maior/;

describe('R3-01: escala maior incremental (não congela ao vivo)', () => {
  const list = longWaves(longWaves(new Bars(), 1, 16), -1, 16).list;
  const ref = referenceHigher(list, '1d', '1w', 'UTC', 'Semanal');

  it('a série de teste tem o semanal virando para baixa depois do candle 720', () => {
    expect(ref[719]?.trend).toBe('alta');
    expect(ref.at(-1)?.trend).toBe('baixa');
  });

  it('motor alimentado candle a candle (como o worker) usa a escala maior correta em cada candle', () => {
    const live = new SetupEngine({ tf: '1d', tz: 'UTC', strict: true });
    for (const c of list.slice(0, 720)) live.push(c); // "build" do worker
    const seen: (HigherContext | null)[] = [];
    const ctxs = spy(live);
    for (const c of list.slice(720)) {
      live.push(c);
      seen.push(live.higherNow());
    }
    expect(seen).toEqual(ref.slice(720));
    expect(ctxs.map((x) => x.higher ?? null)).toEqual(ref.slice(720));
    expect(live.higherNow()).toEqual({ trend: 'baixa', tfLabel: 'Semanal' });
    expect(live.higherTf).toBe('1w');
  });

  it('mesmos eventos: motor ao vivo = motor em lote com a referência da escala maior', () => {
    const live = new SetupEngine({ tf: '1d', tz: 'UTC' });
    for (const c of list) live.push(c);
    const batch = detectSetups(list, { tf: '1d', tz: 'UTC', higher: (t) => ref[t] ?? null });
    expect(live.events).toEqual(batch);
    // e a escala maior realmente entrou nos eventos (aviso vermelho depois da virada)
    expect(live.events.some((e) => e.index >= 720 && e.againstHigher)).toBe(true);
    // higherContextFn (lote) é um retrato que não depende de array externo
    const h = higherContextFn(list, '1d', 'UTC')!;
    expect(list.map((_, t) => h.fn(t))).toEqual(ref);
  });

  it('AlertRuntime: a escala maior continua viva depois de cortar o histórico (maxCandles)', () => {
    const rt = new AlertRuntime({ tf: '1d', tz: 'UTC', tick: 0.01, maxCandles: 300 });
    rt.warmup(list.slice(0, 720), false);
    rt.add({
      id: 'a',
      trigger: 'close',
      condition: {
        kind: 'setup',
        setups: ALL_SETUPS,
        states: ['radar', 'armado', 'acionado', 'encerrado'],
        sides: ['buy', 'sell'],
      },
    });
    const hits = list.slice(720).flatMap((c) => rt.update(c, true));
    const batch = detectSetups(list, {
      tf: '1d',
      tz: 'UTC',
      tick: 0.01,
      higher: (t) => ref[t] ?? null,
    }).filter((e) => e.index >= 720);
    expect(hits.map((h) => h.dedup)).toEqual(batch.map((e) => `${e.id}:${e.state}:${e.index}`));
    const red = batch.filter((e) => e.againstHigher).map((e) => `${e.id}:${e.state}:${e.index}`);
    expect(red.length).toBeGreaterThan(0);
    for (const h of hits) expect(RED.test(h.text)).toBe(red.includes(h.dedup));
  });

  it('sem look-ahead com a escala maior ligada: mudar o futuro não muda o passado', () => {
    const base = walk(1400, 21);
    const full = detectSetups(base, { tf: '1d', tz: 'UTC', strict: true });
    const k = 900;
    const changed = [
      ...base.slice(0, k + 1),
      ...walk(1400 - k - 1, 99).map((c, i) => ({ ...c, time: base[k + 1 + i]!.time })),
    ];
    const alt = detectSetups(changed, { tf: '1d', tz: 'UTC', strict: true });
    const past = (evs: SetupEvent[]) => evs.filter((e) => e.index <= k);
    expect(past(alt)).toEqual(past(full));
  });
});

describe('R3-08: escala maior entre intradiário e diário respeita o fuso', () => {
  const tz = 'America/Sao_Paulo';
  const list = hourly(200, 3);
  const ref = referenceHigher(list, '60m', '1d', tz, 'Diário');

  it('o candle das 22h/23h locais não enxerga o dia ainda em formação', () => {
    const e = new SetupEngine({ tf: '60m', tz });
    const seen = list.map((c) => {
      e.push(c);
      return e.higherNow();
    });
    expect(seen).toEqual(ref);
    const h = higherContextFn(list, '60m', tz)!;
    expect(list.map((_, t) => h.fn(t))).toEqual(ref);
  });
});

describe('R3-02 / R2-11 / R3-05: média respeitada candle a candle', () => {
  it('painel e recuo "auto" usam a MME9 quando é ela que o ativo respeita', () => {
    const b = shallow();
    const r = computeContext(b.list)!;
    expect(r.respected.value?.ma).toBe('ema9');
    const radar = run(b, ['pullback']).filter((e) => e.state === 'radar');
    expect(radar.some((e) => /região da MME9/.test(e.reason))).toBe(true);
  });

  it('o motor entrega em cada candle a MESMA média do painel calculado naquele candle', () => {
    const b = shallow();
    const e = new SetupEngine({ only: ['pullback'], strict: true });
    const ctxs = spy(e);
    for (const c of b.list) e.push(c);
    for (let t = 30; t < b.n; t++) {
      const panel = computeContext(b.list, { lastIndex: t })?.respected.value?.ma ?? null;
      expect(ctxs[t]?.respectedMa ?? null).toBe(panel);
    }
  });

  it('respectedMaAt só usa fundos confirmados até t (sem look-ahead)', () => {
    const list = walk(600, 5);
    const s = new SeriesBuffer();
    s.strict = true;
    const piv = new PivotTracker(DEFAULT_PA.pivotN);
    list.forEach((c, t) => {
      s.push(c);
      s.cursor = t;
      piv.step(s, t);
    });
    const ps = new SeriesBuffer();
    const pp = new PivotTracker(DEFAULT_PA.pivotN);
    list.forEach((c, t) => {
      ps.push(c);
      pp.step(ps, t);
      s.cursor = t; // a série completa só pode ser lida até t
      expect(respectedMaAt(s, piv, t, DEFAULT_PA)).toEqual(respectedMaAt(ps, pp, t, DEFAULT_PA));
    });
  });

  it('a tolerância (respectNearAtr) é parâmetro: com 0 nenhuma média é respeitada', () => {
    const b = shallow();
    const pa = { ...DEFAULT_PA, respectNearAtr: 0 };
    const r = computeContext(b.list, { pa })!;
    expect(r.respected.value).toBeNull();
    const p = params((x) => {
      x.pa.respectNearAtr = 0;
    });
    const radar = run(b, ['pullback'], p).filter((e) => e.state === 'radar');
    expect(radar.some((e) => /região da MME9/.test(e.reason))).toBe(false);
  });
});

describe('R3-03: aviso vermelho contra a escala maior', () => {
  it('eventos de compra com a escala maior em baixa levam o aviso vermelho', () => {
    const evs = detectSetups(waves(1, 10).list, {
      only: ['s91', 's92', 's93', 'consolidation', 'elastic'],
      strict: true,
      higher: () => ({ trend: 'baixa', tfLabel: 'Semanal' }),
    });
    const buys = evs.filter((e) => e.side === 'buy' && e.state !== 'encerrado');
    expect(buys.length).toBeGreaterThan(0);
    for (const e of buys) {
      expect(e.againstHigher).toBe(true);
      expect(e.notes?.join(' ')).toMatch(
        /⚠ Aviso vermelho: contra a escala maior \(Semanal em baixa\)/,
      );
    }
  });

  it('venda com a escala maior em alta leva o aviso; a favor não leva', () => {
    const b = new Bars();
    for (let i = 0; i < 40; i++) {
      const c = i % 2 ? 100.5 : 99.5;
      b.add(c === 100.5 ? 99.5 : 100.5, Math.max(c, 100) + 0.3, Math.min(c, 100) - 0.5, c);
    }
    b.add(100.5, 106, 100.4, 105.5); // fecha muito acima da banda superior → venda do elástico
    const up = detectSetups(b.list, {
      only: ['elastic'],
      higher: () => ({ trend: 'alta', tfLabel: 'Semanal' }),
    });
    const sells = up.filter((e) => e.side === 'sell');
    expect(sells.length).toBeGreaterThan(0);
    expect(sells.every((e) => e.againstHigher === true)).toBe(true);
    const down = detectSetups(b.list, {
      only: ['elastic'],
      higher: () => ({ trend: 'baixa', tfLabel: 'Semanal' }),
    });
    expect(down.filter((e) => e.side === 'sell').some((e) => e.againstHigher)).toBe(false);
  });

  it('painel: escala maior em baixa = vento contra para compras, mesmo com a menor lateral', () => {
    const b = new Bars();
    for (let i = 0; i < 120; i++) b.to(100 + Math.sin(i / 3) * 0.8, { range: 1 });
    const r = computeContext(b.list, { higherTrend: 'baixa', higherLabel: 'Semanal' })!;
    expect(r.trend.value).toBe('lateral');
    expect(r.wind.value).toBe('contra');
    expect(r.wind.label).toMatch(/compras/);
    const down = computeContext(waves(-1, 10).list, { higherTrend: 'baixa' })!;
    expect(down.wind.value).toBe('contra');
  });
});

describe('R3-06: aquecimento sem MMA50 não vira "lateral"', () => {
  it('com menos candles que a MMA50 precisa, a tendência é indefinida', () => {
    const b = waves(1, 3); // 46 candles
    const r = computeContext(b.list)!;
    expect(r.trend.value).toBe('indefinida');
    expect(r.trend.why.join(' ')).toMatch(/dados insuficientes/);
    expect(r.trend.why.join(' ')).not.toMatch(/MMA50 plana/);
    expect(r.alignment.label).toMatch(/Sem dados/);
    expect(trendSeries(b.list).at(-1)).toBe('indefinida');
  });
});

describe('R3-07: tendência exige inclinação da MMA50 (não basta subir 1 candle)', () => {
  it('nenhum candle em "alta" com a MMA50 plana ou caindo (e espelhado na baixa)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const list = walk(2000, seed);
      const tr = trendSeries(list);
      const s = new SeriesBuffer();
      for (const c of list) s.push(c);
      tr.forEach((x, t) => {
        const sl = slope(s, s.sma50, t, DEFAULT_PA);
        if (x === 'alta') expect(sl).toBeGreaterThanOrEqual(DEFAULT_PA.flatSlope);
        if (x === 'baixa') expect(sl).toBeLessThanOrEqual(-DEFAULT_PA.flatSlope);
      });
      // o painel usa a mesma regra
      for (const t of [300, 700, 1100, 1500, 1900]) {
        const r = computeContext(list, { lastIndex: t })!;
        expect(r.trend.value).toBe(tr[t]);
      }
    }
  });
});

describe('R3-09: empate nos pivôs (fundo duplo e topo duplo)', () => {
  it('mínimas iguais na vizinhança: registra o PRIMEIRO dos empatados', () => {
    const b = new Bars();
    for (const l of [14, 13, 12, 11, 10, 10, 11, 12, 13, 14]) b.add(l + 1, l + 2, l, l + 1);
    const s = new SeriesBuffer();
    const p = new PivotTracker(2);
    b.list.forEach((c, t) => {
      s.push(c);
      p.step(s, t);
    });
    expect(p.lows.map((x) => [x.index, x.confirmedAt])).toEqual([[4, 6]]);
  });

  it('máximas iguais (topo duplo e triplo): registra o primeiro', () => {
    const b = new Bars();
    for (const h of [10, 11, 12, 13, 14, 14, 14, 13, 12, 11, 10]) b.add(h - 1, h, h - 2, h - 1);
    const s = new SeriesBuffer();
    const p = new PivotTracker(2);
    b.list.forEach((c, t) => {
      s.push(c);
      p.step(s, t);
    });
    expect(p.highs.map((x) => [x.index, x.confirmedAt])).toEqual([[4, 6]]);
  });
});

describe('R3-10: maturidade com os critérios da SPEC', () => {
  /** Alta longa e desacelerando, longe da MMA200, com volume das correções `corrVol`. */
  function tired(corrVol: number): Bars {
    const b = new Bars();
    let c = 100;
    b.add(c, c + 0.5, c - 0.5, c);
    for (let k = 0; k < 24; k++) {
      const step = k < 18 ? 1.6 : 0.9;
      for (let i = 0; i < 10; i++) b.to((c += step), { range: 1.2, v: 1000 });
      for (let i = 0; i < 4; i++) b.to((c -= 1.0), { range: 0.8, v: corrVol });
    }
    for (let i = 0; i < 6; i++) b.to((c += 0.6), { range: 1.0, v: 1000 });
    return b;
  }

  it('"cansada" exige volume menor nas altas e maior nas correções', () => {
    const healthy = computeContext(tired(500).list)!;
    expect(healthy.trend.value).toBe('alta');
    expect(healthy.maturity.value).not.toBe('cansada');
    const weak = computeContext(tired(2000).list)!;
    expect(weak.maturity.value).toBe('cansada');
    expect(weak.maturity.why.join(' ')).toMatch(/volume/);
  });

  /** Queda em ondas, virada em V com topo em ~126,6 e depois deriva de alta de `drift` por candle. */
  function turn(drift: number): Bars {
    const b = new Bars();
    let c = 160;
    b.add(c, c + 0.5, c - 0.5, c);
    for (let k = 0; k < 5; k++) {
      for (let i = 0; i < 8; i++) b.to((c -= 1.8), { range: 1.2 });
      for (let i = 0; i < 4; i++) b.to((c += 0.6), { range: 0.8 });
    }
    for (let i = 0; i < 8; i++) b.to((c += 2), { range: 1.2 });
    for (let i = 0; i < 4; i++) b.to((c -= 1.5), { range: 0.8 });
    for (let i = 0; i < 8; i++) b.to((c += 2), { range: 1.2 });
    for (let i = 0; i < 4; i++) b.to((c -= 1.2), { range: 0.8 });
    for (let i = 0; i < 18; i++) b.to((c += drift), { range: 0.8 });
    return b;
  }

  it('"jovem" exige que a MMA50 tenha virado E que a resistência relevante tenha sido rompida', () => {
    const stuck = computeContext(turn(0.15).list)!; // fica abaixo do topo de 126,6
    expect(stuck.trend.value).toBe('alta');
    expect(stuck.maturity.value).not.toBe('jovem');
    expect(stuck.maturity.why.join(' ')).toMatch(/ainda não rompeu a resistência 126,60/);
    const broke = computeContext(turn(0.35).list)!; // fecha acima do topo
    expect(broke.maturity.value).toBe('jovem');
    expect(broke.maturity.why.join(' ')).toMatch(/rompeu a resistência 126,60 por fechamento/);
    expect(DEFAULT_SETUP_PARAMS.pa.respectNearAtr).toBe(0.5);
  });
});
