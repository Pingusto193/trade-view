import { describe, expect, it } from 'vitest';
import { detectSetups, ema } from '../../src';
import { Bars, params, run, states } from './helpers';

/** Tendência de alta em ondas (impulsos e recuos) para gerar pivôs reais. */
function waves(
  cycles: number,
  o: { up?: number; nUp?: number; down?: number; nDown?: number } = {},
): Bars {
  const { up = 1.2, nUp = 10, down = 1.0, nDown = 5 } = o;
  const b = new Bars();
  let c = 100;
  b.add(c, c + 0.5, c - 0.5, c);
  for (let k = 0; k < cycles; k++) {
    for (let i = 0; i < nUp; i++) b.to((c += up), { range: 1.2, v: 1200 });
    for (let i = 0; i < nDown; i++) b.to((c -= down), { range: 0.7, v: 700 });
  }
  return b;
}

/** waves(10) cortada no índice 60, onde o recuo arma: gatilho 129,36, stop 127,64 (MME21 ≈ 126,96). */
function armedAt60(): Bars {
  const b = waves(10);
  b.list.length = 61;
  return b;
}

describe('R2-01: ordem stop executa antes das invalidações pelo fechamento', () => {
  it('base: a série arma no índice 60 com gatilho e stop conhecidos', () => {
    const evs = run(armedAt60(), ['pullback']);
    expect(states(evs)).toEqual(['60:radar', '60:armado']);
    expect(evs[1]?.trigger).toBe(129.36);
    expect(evs[1]?.stop).toBe(127.64);
  });

  it('candle que rompe o gatilho e fecha abaixo da média que vira para baixo é ENTRADA com perda', () => {
    const b = armedAt60();
    b.add(128, 129.96, 126.4, 126.56, 1500);
    const evs = run(b, ['pullback']).filter((e) => e.index === 61);
    expect(states(evs)).toEqual(['61:acionado', '61:encerrado/stop']);
    expect(evs[0]?.price).toBe(129.36);
    expect(evs[1]?.price).toBe(127.64);
    expect(evs[1]?.resultR).toBeCloseTo(-1, 6);
  });

  it('candle que rompe o gatilho e fecha abaixo do fundo anterior também é ENTRADA com perda', () => {
    const b = armedAt60();
    b.add(128, 129.96, 105, 106, 3000);
    const evs = run(b, ['pullback']).filter((e) => e.index === 61);
    expect(states(evs)).toEqual(['61:acionado', '61:encerrado/stop']);
    expect(evs[1]?.resultR).toBeCloseTo(-1, 6);
  });

  it('negativo: sem romper o gatilho, fechar abaixo da média que vira para baixo invalida', () => {
    const b = armedAt60();
    b.add(128, 129.2, 126.4, 126.56, 1500); // máxima abaixo do gatilho 129,36
    const evs = run(b, ['pullback']).filter((e) => e.index === 61);
    expect(states(evs)).toEqual(['61:encerrado/invalidado']);
    expect(evs[0]?.reason).toMatch(/virou para baixo e foi perdida/);
  });

  it('borda: escala maior contra já é conhecida na abertura e invalida antes do gatilho', () => {
    const b = armedAt60();
    b.add(128, 129.96, 127.9, 129.5, 1500);
    const evs = detectSetups(b.list, {
      only: ['pullback'],
      strict: true,
      higher: (t) => ({ trend: t >= 61 ? 'baixa' : 'alta', tfLabel: 'Semanal' }),
    }).filter((e) => e.index === 61);
    expect(states(evs)).toEqual(['61:encerrado/invalidado']);
    expect(evs[0]?.reason).toMatch(/escala maior/);
  });
});

describe('R2-08: radar que não arma expira (pullback.radarExpiryBars)', () => {
  /**
   * Recuo com alertas (barra de força de baixa e volume alto) que nunca arma com requireHealthy;
   * depois, alta longa com novos topos e um recuo saudável até a MME21.
   */
  function staleThenHealthy() {
    const b = waves(3);
    b.trend(10, 1.2, { range: 1.2, v: 1200 });
    b.to(b.last.close - 1, { range: 0.7, v: 700 });
    b.add(b.last.close, b.last.close + 0.1, b.last.close - 3.3, b.last.close - 3.2, 3000);
    for (let i = 0; i < 3; i++) b.to(b.last.close - 0.3, { range: 0.3, v: 700 });
    const stale = b.n;
    b.trend(20, 1.2, { range: 1.2, v: 1200 });
    const healthy = b.n;
    for (let i = 0; i < 8; i++) b.to(b.last.close - 1.3, { range: 0.2, v: 600 });
    b.trend(6, 1.2, { range: 1.2, v: 1200 });
    return { b, stale, healthy };
  }

  it('expira e não bloqueia o recuo saudável seguinte', () => {
    const { b, stale, healthy } = staleThenHealthy();
    const p = params((q) => {
      q.pullback.requireHealthy = true;
    });
    const evs = run(b, ['pullback'], p);
    const first = evs.find((e) => e.state === 'radar');
    expect(first).toBeDefined();
    expect(first!.index).toBeLessThanOrEqual(stale);
    expect(first!.notes?.join(' ')).toMatch(/barra de força de baixa/);
    expect(evs.some((e) => e.id === first!.id && e.state === 'armado')).toBe(false);
    const end = evs.find((e) => e.id === first!.id && e.state === 'encerrado');
    expect(end?.exit).toBe('expirou');
    expect(end?.reason).toMatch(/Não armou em 15 candles/);
    expect(end?.index).toBe(first!.index + p.pullback.radarExpiryBars);
    // o recuo saudável depois da alta é detectado e arma
    expect(evs.some((e) => e.state === 'armado' && e.index >= healthy)).toBe(true);
  });

  it('a validade é o parâmetro: com validade longa o radar segue aberto até ser invalidado', () => {
    const { b, healthy } = staleThenHealthy();
    const p = params((q) => {
      q.pullback.requireHealthy = true;
      q.pullback.radarExpiryBars = 100;
    });
    const evs = run(b, ['pullback'], p);
    expect(evs.some((e) => e.exit === 'expirou')).toBe(false);
    expect(evs.some((e) => e.state === 'armado' && e.index >= healthy)).toBe(false);
  });

  it('borda: na série padrão os radares armam dentro da validade (nenhum expira)', () => {
    const evs = run(waves(10), ['pullback']);
    expect(evs.some((e) => e.exit === 'expirou' && /Não armou/.test(e.reason))).toBe(false);
  });
});

describe('R2-12 (parte do recuo): inclinação da MME21 usa pa.slopeLookback', () => {
  it('o radar só aparece com a MME21 subindo no passo configurado (não um passo fixo de 5)', () => {
    // recuos longos: a MME21 vira para baixo no candle anterior antes de virar em 5 candles
    const b = waves(8, { down: 1.2, nDown: 7 });
    const e21 = ema(
      b.list.map((c) => c.close),
      21,
    );
    const radars = (k: number) =>
      detectSetups(b.list, {
        only: ['pullback'],
        strict: true,
        params: params((q) => {
          q.pa.slopeLookback = k;
        }),
      })
        .filter((e) => e.state === 'radar')
        .map((e) => e.index);
    for (const k of [1, 8]) {
      const idx = radars(k);
      expect(idx.length).toBeGreaterThan(0);
      for (const i of idx) expect(e21[i]! > e21[i - k]!).toBe(true);
    }
    expect(radars(1)).not.toEqual(radars(5));
  });
});

describe('ma = "auto" usa a média respeitada do contexto (regressão)', () => {
  it('sem média respeitada usa a MME21; com ela, a respeitada; a escolhida explicitamente prevalece', () => {
    const b = waves(10);
    const reasons = (respectedMa?: 'ema9') =>
      detectSetups(b.list, {
        only: ['pullback'],
        strict: true,
        respectedMa: respectedMa ?? null,
      })
        .filter((e) => e.state === 'radar')
        .map((e) => e.reason);
    const r21 = reasons();
    expect(r21.length).toBeGreaterThan(0);
    expect(r21.every((r) => /MME21/.test(r))).toBe(true);
    const r9 = reasons('ema9');
    expect(r9.length).toBeGreaterThan(0);
    expect(r9.every((r) => /MME9/.test(r))).toBe(true);
    const fixed = detectSetups(b.list, {
      only: ['pullback'],
      strict: true,
      respectedMa: 'ema9',
      params: params((q) => {
        q.pullback.ma = 'ema21';
      }),
    }).filter((e) => e.state === 'radar');
    expect(fixed.length).toBeGreaterThan(0);
    expect(fixed.every((e) => /MME21/.test(e.reason))).toBe(true);
  });
});
