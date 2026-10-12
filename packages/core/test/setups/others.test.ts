import { describe, expect, it } from 'vitest';
import { bollinger, computeContext, detectSetups } from '../../src';
import { Bars, params, run, states } from './helpers';

/** Série lateral com ruído pequeno e alternado (Bollinger estreita). */
function flat(n = 40): Bars {
  const b = new Bars();
  for (let i = 0; i < n; i++) {
    const c = i % 2 ? 100.5 : 99.5;
    b.add(c === 100.5 ? 99.5 : 100.5, Math.max(c, 100) + 0.3, Math.min(c, 100) - 0.3 - 0.2, c);
  }
  return b;
}

describe('Elástico (Bollinger 20/3)', () => {
  it('pavio fora da banda NÃO arma; só o fechamento conta (SPEC §19)', () => {
    const b = flat();
    const lower = bollinger(
      b.list.map((c) => c.close),
      20,
      3,
    ).at(-1)!.lower;
    b.add(100, 100.4, lower - 5, 99.8); // pavio muito abaixo, fecha dentro
    expect(run(b, ['elastic']).filter((e) => e.index === b.n - 1)).toEqual([]);
  });

  it('fechamento abaixo da banda: radar e armado; rompe a máxima e sai na média central', () => {
    const b = flat();
    const closes = b.list.map((c) => c.close);
    const lower = bollinger([...closes], 20, 3).at(-1)!.lower;
    b.add(99.5, 99.6, lower - 2, lower - 1.5); // fecha fora
    const out = b.n - 1;
    const trig = b.last.high + 0.01;
    b.add(b.last.close, trig + 0.3, b.last.close - 0.2, trig + 0.2); // rompe a máxima
    b.add(b.last.close, 101, b.last.close - 0.1, 100.8); // volta à média
    const evs = run(b, ['elastic']).filter((e) => e.index >= out);
    expect(states(evs)).toEqual([
      `${out}:radar`,
      `${out}:armado`,
      `${out + 1}:acionado`,
      `${out + 2}:encerrado/alvo`,
    ]);
    expect(evs[0]?.reason).toMatch(/Ainda NÃO é compra/);
    expect(evs[3]?.resultR).toBeGreaterThan(0);
  });

  it('expira em 5 candles sem acionar; cancela se voltar à média sem acionar', () => {
    const b = flat();
    const lower = bollinger(
      b.list.map((c) => c.close),
      20,
      3,
    ).at(-1)!.lower;
    b.add(99.5, 99.6, lower - 2, lower - 1.5);
    const out = b.n - 1;
    // candles cada vez mais baixos: nunca rompe a máxima anterior
    for (let i = 0; i < 6; i++)
      b.add(b.last.close, b.last.close + 0.05, b.last.close - 0.6, b.last.close - 0.5);
    const evs = run(b, ['elastic']).filter((e) => e.index >= out && e.side === 'buy');
    expect(evs.at(-1)?.exit).toBe('expirou');
  });

  it('venda espelhada: fechamento acima da banda superior', () => {
    const b = flat();
    const upper = bollinger(
      b.list.map((c) => c.close),
      20,
      3,
    ).at(-1)!.upper;
    b.add(100.5, upper + 2, 100.4, upper + 1.5);
    const evs = run(b, ['elastic']).filter((e) => e.index === b.n - 1);
    expect(evs.map((e) => `${e.side}:${e.state}`)).toEqual(['sell:radar', 'sell:armado']);
  });
});

describe('Rompimento de consolidação', () => {
  function boxAfterTrend(breakVol: number): { b: Bars; boxEnd: number } {
    const b = new Bars().trend(70, 1, { range: 1.5, v: 1000 });
    const top = b.last.close + 0.6;
    for (let i = 0; i < 14; i++)
      b.add(b.last.close, top, top - 1.8, i % 2 ? top - 0.4 : top - 1.2, 600);
    const boxEnd = b.n - 1;
    b.add(b.last.close, top + 3.2, b.last.close - 0.1, top + 3, breakVol); // rompe com corpo grande
    b.add(b.last.close + 0.2, b.last.close + 1.5, b.last.close, b.last.close + 1.2, 900);
    return { b, boxEnd };
  }

  it('radar na caixa apertada; fechamento acima do topo com volume arma; entra na abertura seguinte', () => {
    const { b, boxEnd } = boxAfterTrend(2500);
    const evs = run(b, ['consolidation']);
    const radar = evs.find((e) => e.state === 'radar');
    expect(radar).toBeDefined();
    expect(radar!.index).toBeLessThanOrEqual(boxEnd);
    const armed = evs.find((e) => e.state === 'armado');
    expect(armed?.index).toBe(boxEnd + 1);
    expect(armed?.reason).toMatch(/volume/);
    const acted = evs.find((e) => e.state === 'acionado');
    expect(acted?.index).toBe(boxEnd + 2);
    expect(acted?.entry).toBe(b.list[boxEnd + 2]!.open);
  });

  it('rompimento sem volume é suspeito (cancelado); com o filtro desligado, arma (E5)', () => {
    const { b } = boxAfterTrend(700);
    const evs = run(b, ['consolidation']);
    expect(evs.find((e) => e.state === 'encerrado')?.reason).toMatch(/sem confirmação/);
    const noVol = params((p) => {
      p.consolidation.requireVolume = false;
    });
    expect(run(b, ['consolidation'], noVol).some((e) => e.state === 'armado')).toBe(true);
  });
});

/** Tendência em ondas (impulsos e recuos) para gerar pivôs reais. */
function waves(dir: 1 | -1, cycles = 8): Bars {
  const b = new Bars();
  let c = 100;
  b.add(c, c + 0.5, c - 0.5, c);
  for (let k = 0; k < cycles; k++) {
    for (let i = 0; i < 10; i++) b.to((c += dir * 1.2), { range: 1.2, v: 1200 });
    for (let i = 0; i < 5; i++) b.to((c -= dir * 1.0), { range: 0.7, v: 700 });
  }
  return b;
}

describe('Recuo à média', () => {
  it('em tendência de alta em ondas: radar na região da média e depois arma com gatilho', () => {
    const evs = run(waves(1, 10), ['pullback']);
    const radar = evs.filter((e) => e.state === 'radar');
    expect(radar.length).toBeGreaterThan(0);
    expect(radar[0]?.reason).toMatch(/Tocar a média NÃO é sinal/);
    expect(evs.some((e) => e.state === 'armado')).toBe(true);
  });

  it('em tendência de baixa não existe setup', () => {
    expect(run(waves(-1, 10), ['pullback'])).toEqual([]);
  });

  it('escala maior em baixa impede o setup', () => {
    const b = waves(1, 10);
    const evs = detectSetups(b.list, {
      only: ['pullback'],
      strict: true,
      higher: () => ({ trend: 'baixa', tfLabel: 'Semanal' }),
    });
    expect(evs.filter((e) => e.state !== 'encerrado')).toEqual([]);
  });
});

describe('Reflexividade', () => {
  it('queda de 50%+ com médias caindo gera radar com aviso de viés de sobrevivência; pivô de alta arma', () => {
    const b = new Bars().trend(60, 1, { range: 2 }); // até ~160
    for (let i = 0; i < 40; i++) b.to(b.last.close * 0.975, { range: 1.5 }); // queda ~64%
    // fundo, repique, fundo mais alto e rompimento
    for (const c of [62, 60, 61, 64, 67, 66, 64]) b.to(c, { range: 1.2 });
    b.add(64, 64.3, 62, 63); // fundo mais alto (F2) bem definido
    b.add(63, 65.5, 62.8, 65.2).add(65.2, 68.5, 64.8, 68.2); // fecha acima do topo intermediário
    for (const c of [72, 75, 78]) b.to(c, { range: 1.2 });
    const evs = run(b, ['reflexivity']);
    const radar = evs.find((e) => e.state === 'radar');
    expect(radar).toBeDefined();
    expect(radar!.notes?.join(' ')).toMatch(/viés de sobrevivência/);
    expect(radar!.notes?.join(' ')).toMatch(/Fundamentos NÃO verificados/);
    expect(evs.some((e) => e.state === 'armado' && /Pivô de alta/.test(e.reason))).toBe(true);
  });
});

describe('Painel de contexto', () => {
  it('tendência de alta em ondas: alta, alinhamento, ADX e "porquê"', () => {
    const r = computeContext(waves(1, 10).list)!;
    expect(r.trend.value).toBe('alta');
    expect(r.structure.value).toBe('alta');
    expect(r.trend.why.join(' ')).toMatch(/MMA50 subindo/);
    expect(r.adx.value).not.toBeNull();
    expect(r.maturity.label).toMatch(/experimental/);
  });

  it('vento contra quando a escala maior está em baixa', () => {
    const r = computeContext(waves(1, 10).list, { higherTrend: 'baixa', higherLabel: 'Semanal' })!;
    expect(r.wind.value).toBe('contra');
    expect(r.wind.why.join(' ')).toMatch(/ATENÇÃO/);
  });

  it('série lateral: tendência lateral', () => {
    const b = new Bars();
    for (let i = 0; i < 120; i++) b.to(100 + Math.sin(i / 3) * 0.8, { range: 1 });
    expect(computeContext(b.list)!.trend.value).toBe('lateral');
  });
});
