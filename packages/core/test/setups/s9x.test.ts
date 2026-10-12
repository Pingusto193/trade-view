import { describe, expect, it } from 'vitest';
import { ema } from '../../src';
import { Bars, params, run, states } from './helpers';

/** Tendência de alta firme (MMA50 subindo, ADX alto) seguida de um recuo curto. */
function uptrendWithDip(dip = 4): Bars {
  const b = new Bars().trend(80, 1, { range: 1.5 });
  for (let i = 0; i < dip; i++) b.to(b.last.close - 1.5, { range: 1.2 });
  return b;
}

describe('Setup 9.1', () => {
  it('arma no candle que vira a MME9 para cima, aciona no rompimento e sai no alvo de 2R', () => {
    const b = uptrendWithDip();
    const sig = b.n;
    b.add(b.last.close, b.last.close + 4, b.last.close - 0.3, b.last.close + 3.5); // candle-sinal
    const e9 = ema(
      b.list.map((c) => c.close),
      9,
    );
    expect(e9[sig]! > e9[sig - 1]! && e9[sig - 1]! <= e9[sig - 2]!).toBe(true); // a MME9 virou aqui
    const trig = b.last.high + 0.01;
    b.add(b.last.close, trig + 1, b.last.close - 0.2, trig + 0.8); // rompe
    for (let i = 0; i < 12; i++) b.to(b.last.close + 1.2, { range: 0.8 }); // segue até o alvo
    const evs = run(b, ['s91']);
    const mine = evs.filter((e) => e.index >= sig);
    expect(states(mine).slice(0, 3)).toEqual([
      `${sig}:armado`,
      `${sig + 1}:acionado`,
      expect.stringMatching(/:encerrado\/alvo$/),
    ]);
    expect(mine[0]?.trigger).toBeCloseTo(trig, 6);
    expect(mine[0]?.stop).toBeCloseTo(b.list[sig]!.low - 0.01, 6);
    expect(mine[2]?.resultR).toBeCloseTo(2, 6);
    expect(mine[0]?.reason).toMatch(/MME9 virou para cima/);
  });

  it('filtro MMA50: em tendência de baixa não arma; sem filtro (9.1 puro) arma', () => {
    const b = new Bars().trend(80, -1, { range: 1.5 });
    // na queda constante a MME9 fica ~4 acima do preço: o salto precisa passar dela para virá-la
    b.add(b.last.close, b.last.close + 7, b.last.close - 0.3, b.last.close + 6.5);
    expect(run(b, ['s91']).filter((e) => e.state === 'armado')).toHaveLength(0);
    const pure = params((p) => {
      p.s91.trendFilter = false;
    });
    expect(run(b, ['s91'], pure).filter((e) => e.state === 'armado').length).toBeGreaterThan(0);
  });

  it('se a MME9 virar para baixo antes do acionamento, desarma', () => {
    const b = uptrendWithDip();
    const sig = b.n;
    b.add(b.last.close, b.last.close + 4, b.last.close - 0.3, b.last.close + 3.5);
    b.add(b.last.close, b.last.close + 0.1, b.last.close - 6, b.last.close - 5.5); // não rompe e despenca
    const evs = run(b, ['s91']).filter((e) => e.index >= sig);
    expect(states(evs)).toEqual([`${sig}:armado`, `${sig + 1}:encerrado/desarme`]);
  });

  it('decisão nossa: sem rompimento e MME9 subindo, o gatilho passa para a máxima do novo candle', () => {
    const b = uptrendWithDip();
    const sig = b.n;
    b.add(b.last.close, b.last.close + 4, b.last.close - 0.3, b.last.close + 3.5);
    const h1 = b.last.high;
    b.add(b.last.close - 0.5, h1 - 0.2, b.last.close - 1, h1 - 0.3); // inside, fecha forte (MME9 segue subindo)
    const evs = run(b, ['s91']).filter((e) => e.index >= sig);
    expect(states(evs)).toEqual([`${sig}:armado`, `${sig + 1}:armado`]);
    expect(evs[1]?.trigger).toBeCloseTo(h1 - 0.2 + 0.01, 6);
  });

  it('gap acima do gatilho: entrada na abertura (pior preço)', () => {
    const b = uptrendWithDip();
    b.add(b.last.close, b.last.close + 4, b.last.close - 0.3, b.last.close + 3.5);
    const open = b.last.high + 2;
    b.add(open, open + 1, open - 0.5, open + 0.5);
    const acted = run(b, ['s91']).find((e) => e.state === 'acionado');
    expect(acted?.entry).toBe(open);
    expect(acted?.reason).toMatch(/abertura/);
  });

  it('saída dinâmica: stop sobe quando a MME9 vira para baixo e nunca desce', () => {
    const b = uptrendWithDip();
    b.add(b.last.close, b.last.close + 4, b.last.close - 0.3, b.last.close + 3.5);
    b.add(b.last.close, b.last.high + 1, b.last.close - 0.2, b.last.high + 0.8);
    b.trend(8, 1, { range: 0.8 });
    for (let i = 0; i < 6; i++) b.to(b.last.close - 1.2, { range: 0.8 });
    const p = params((x) => {
      x.s91.exit = { mode: 'dynamic', targetR: 2 };
    });
    const evs = run(b, ['s91'], p);
    const moves = evs.filter((e) => e.state === 'acionado' && /stop móvel/.test(e.reason));
    expect(moves.length).toBeGreaterThan(0);
    const end = evs.find((e) => e.state === 'encerrado');
    expect(end?.exit).toBe('saida-dinamica');
    expect(end?.resultR).toBeGreaterThan(0);
  });
});

/** Alta com MME9 bem abaixo do preço, para a correção não virar a MME9 de imediato. */
function legUp(): Bars {
  return new Bars().trend(60, 1, { range: 1 });
}

describe('Setup 9.2', () => {
  it('arma quando um candle fecha abaixo da mínima do candle de referência com a MME9 subindo', () => {
    const b = legUp();
    const ref = b.n - 1;
    const refLow = b.last.low;
    b.add(b.last.close, b.last.close + 0.2, refLow - 1, refLow - 0.5); // fecha abaixo da mínima da referência
    const evs = run(b, ['s92']).filter((e) => e.index > ref);
    expect(states(evs)).toEqual([`${ref + 1}:armado`]);
    expect(evs[0]?.refs).toEqual([ref, ref + 1]);
    expect(evs[0]?.trigger).toBeCloseTo(b.last.high + 0.01, 6);
    expect(evs[0]?.stop).toBeCloseTo(refLow - 1 - 0.01, 6);
  });

  it('MME9 virou para baixo durante a correção desarma o 9.2 (SPEC §19)', () => {
    const b = legUp();
    const ref = b.n - 1;
    b.add(b.last.close, b.last.close + 0.2, b.last.low - 1, b.last.low - 0.5);
    for (let i = 0; i < 6; i++)
      b.add(b.last.close, b.last.close + 0.1, b.last.close - 3.2, b.last.close - 3); // não rompe; cai forte
    const evs = run(b, ['s92']).filter((e) => e.index > ref);
    expect(evs[0]?.state).toBe('armado');
    const end = evs.find((e) => e.state === 'encerrado');
    expect(end?.exit).toBe('desarme');
    expect(end?.reason).toMatch(/MME9 apontou para baixo/);
  });

  it('não rompeu: gatilho passa para a máxima do próximo candle da correção', () => {
    const b = legUp();
    b.add(b.last.close, b.last.close + 0.2, b.last.low - 1, b.last.low - 0.5);
    const armIdx = b.n - 1;
    const h = b.last.high;
    b.add(b.last.close, h - 0.3, b.last.close - 0.4, b.last.close - 0.1);
    const evs = run(b, ['s92']).filter((e) => e.index >= armIdx);
    expect(evs.map((e) => e.state)).toEqual(['armado', 'armado']);
    expect(evs[1]?.trigger).toBeCloseTo(h - 0.3 + 0.01, 6);
  });
});

describe('Setup 9.3', () => {
  it('arma com dois fechamentos consecutivos abaixo do fechamento de referência', () => {
    const b = legUp();
    const ref = b.n - 1;
    const rc = b.last.close;
    b.add(rc, rc + 0.2, rc - 0.6, rc - 0.4).add(rc - 0.4, rc - 0.1, rc - 0.8, rc - 0.5);
    const evs = run(b, ['s93']).filter((e) => e.index > ref);
    expect(states(evs)).toEqual([`${ref + 2}:armado`]);
  });

  it('dois fechamentos NÃO consecutivos não armam com o parâmetro padrão (SPEC §19)', () => {
    const b = legUp();
    const rc = b.last.close;
    const ref = b.n - 1;
    b.add(rc, rc + 0.2, rc - 0.6, rc - 0.4); // abaixo
    b.add(rc - 0.4, rc + 0.1, rc - 0.5, rc); // igual à referência: não é abaixo nem nova referência
    b.add(rc, rc + 0.1, rc - 0.6, rc - 0.3); // abaixo de novo
    expect(run(b, ['s93']).filter((e) => e.index > ref)).toEqual([]);
    const loose = params((p) => {
      p.s93.consecutive = false;
    });
    expect(states(run(b, ['s93'], loose).filter((e) => e.index > ref))).toEqual([
      `${ref + 3}:armado`,
    ]);
  });
});
