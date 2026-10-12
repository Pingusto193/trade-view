import { describe, expect, it } from 'vitest';
import { ema } from '../../src';
import { Bars, params, run, states } from './helpers';

/** Alta firme, V com fundo nítido (fundo confirmado), nova alta e recuo curto antes do candle-sinal. */
function uptrendWithPriorSwing(): { b: Bars; sig: number; swingLow: number } {
  const b = new Bars().trend(60, 1, { range: 1.5 }); // fecha de 101 a 160
  b.to(158, { range: 1.5 }).to(156, { range: 1.5 }).to(154, { range: 1.5 });
  const swingLow = 152.25;
  b.add(154, 154.5, swingLow, 153.5); // fundo do V (confirmado 2 candles depois)
  b.to(155.5, { range: 1.5 }).to(157.5, { range: 1.5 }).to(159.5, { range: 1.5 });
  b.trend(10, 1, { range: 1.5 });
  for (let i = 0; i < 4; i++) b.to(b.last.close - 1.5, { range: 1.2 });
  const sig = b.n;
  b.add(b.last.close, b.last.close + 4, b.last.close - 0.3, b.last.close + 3.5); // candle-sinal
  return { b, sig, swingLow };
}

describe('R1-01 — 9.1 com stop no fundo anterior e gatilho deslocado', () => {
  it('o stop "prior-swing" continua no fundo anterior quando o gatilho passa para o novo candle', () => {
    const { b, sig, swingLow } = uptrendWithPriorSwing();
    const h = b.last.high;
    b.add(b.last.close - 0.3, h - 0.2, b.last.close - 0.8, h - 0.3); // inside, MME9 segue subindo
    b.add(b.last.close, h + 2, b.last.close - 0.2, h + 1.5); // rompe o gatilho deslocado
    const p = params((x) => {
      x.s91.stopMode = 'prior-swing';
    });
    const evs = run(b, ['s91'], p).filter((e) => e.index >= sig);
    expect(states(evs).slice(0, 3)).toEqual([
      `${sig}:armado`,
      `${sig + 1}:armado`,
      `${sig + 2}:acionado`,
    ]);
    const stop = swingLow - 0.01;
    expect(evs[0]?.stop).toBeCloseTo(stop, 6);
    expect(evs[1]?.stop).toBeCloseTo(stop, 6);
    expect(evs[1]?.trigger).toBeCloseTo(h - 0.2 + 0.01, 6);
    const entry = evs[2]!;
    expect(entry.stop).toBeCloseTo(stop, 6);
    expect(entry.target).toBeCloseTo(entry.entry! + 2 * (entry.entry! - stop), 2);
  });

  it('"signal-low" segue como antes: stop abaixo da menor mínima desde o sinal', () => {
    const { b, sig } = uptrendWithPriorSwing();
    const h = b.last.high;
    b.add(b.last.close - 0.3, h - 0.2, b.last.close - 0.8, h - 0.3);
    const lows = Math.min(b.list[sig]!.low, b.last.low);
    const evs = run(b, ['s91']).filter((e) => e.index >= sig);
    expect(states(evs)).toEqual([`${sig}:armado`, `${sig + 1}:armado`]);
    expect(evs[1]?.stop).toBeCloseTo(lows - 0.01, 6);
  });
});

describe('R1-02 — saída dinâmica quando a MME9 vira contra no próprio candle da entrada', () => {
  it('9.1: o stop sobe para a mínima do candle da entrada e sai se ela for perdida', () => {
    const b = new Bars().trend(80, 1, { range: 1.5 });
    for (let i = 0; i < 4; i++) b.to(b.last.close - 1.5, { range: 1.2 });
    const sig = b.n;
    b.add(174, 178, 173.7, 177.5); // candle-sinal: gatilho 178,01, stop 173,69
    b.add(177.5, 178.5, 175.5, 175.7); // aciona e vira a MME9 para baixo
    b.add(175.7, 176, 175.2, 175.5); // perde a mínima do candle que virou a MME9
    for (let i = 0; i < 6; i++) b.to(b.last.close - 0.5, { range: 0.6 });
    const e9 = ema(
      b.list.map((c) => c.close),
      9,
    );
    expect(e9[sig + 1]! < e9[sig]! && e9[sig]! >= e9[sig - 1]!).toBe(true); // virou na entrada
    const p = params((x) => {
      x.s91.exit = { mode: 'dynamic', targetR: 2 };
    });
    const evs = run(b, ['s91'], p).filter((e) => e.index >= sig);
    const move = evs.find((e) => e.state === 'acionado' && /stop móvel/.test(e.reason));
    expect(move?.index).toBe(sig + 1);
    expect(move?.stop).toBeCloseTo(175.49, 6);
    const end = evs.find((e) => e.state === 'encerrado');
    expect(end?.index).toBe(sig + 2);
    expect(end?.exit).toBe('saida-dinamica');
    expect(end?.price).toBeCloseTo(175.49, 6);
    expect(end?.resultR).toBeCloseTo((175.49 - 178.01) / (178.01 - 173.69), 6);
  });

  it('9.2: idem (MME9 vira para baixo no candle da entrada)', () => {
    const b = new Bars().trend(60, 1, { range: 1 }); // referência: candle 59 (F 160, mín. 158,50)
    const armIdx = b.n;
    b.add(160, 160.2, 155.5, 158); // fecha abaixo da mínima da referência: arma (stop 155,49)
    b.add(158, 160.5, 156, 156.2); // aciona em 160,21 e vira a MME9 para baixo
    b.add(156.2, 156.4, 155.8, 156); // perde a mínima do candle da entrada
    for (let i = 0; i < 4; i++) b.to(b.last.close - 0.5, { range: 0.6 });
    const p = params((x) => {
      x.s92.exit = { mode: 'dynamic', targetR: 2 };
    });
    const evs = run(b, ['s92'], p).filter((e) => e.index >= armIdx);
    expect(evs[0]?.state).toBe('armado');
    expect(evs[0]?.stop).toBeCloseTo(155.49, 6);
    const move = evs.find((e) => e.state === 'acionado' && /stop móvel/.test(e.reason));
    expect(move?.index).toBe(armIdx + 1);
    expect(move?.stop).toBeCloseTo(155.99, 6);
    const end = evs.find((e) => e.state === 'encerrado');
    expect(end?.index).toBe(armIdx + 2);
    expect(end?.exit).toBe('saida-dinamica');
    expect(end?.price).toBeCloseTo(155.99, 6);
  });

  it('9.3: idem (MME9 vira para baixo no candle da entrada)', () => {
    const b = new Bars().trend(60, 1, { range: 1 }); // referência: candle 59 (F 160)
    b.add(160, 160.2, 159, 159.5); // 1º fechamento abaixo
    const armIdx = b.n;
    b.add(159.5, 159.8, 157, 158); // 2º: arma (gatilho 159,81, stop 156,99)
    b.add(158, 160, 157.2, 156.5); // aciona e vira a MME9 para baixo
    b.add(157.4, 157.5, 157, 157.1); // perde a mínima do candle da entrada
    for (let i = 0; i < 4; i++) b.to(b.last.close - 0.5, { range: 0.6 });
    const p = params((x) => {
      x.s93.exit = { mode: 'dynamic', targetR: 2 };
    });
    const evs = run(b, ['s93'], p).filter((e) => e.index >= armIdx);
    expect(evs[0]?.state).toBe('armado');
    expect(evs[0]?.stop).toBeCloseTo(156.99, 6);
    const move = evs.find((e) => e.state === 'acionado' && /stop móvel/.test(e.reason));
    expect(move?.index).toBe(armIdx + 1);
    expect(move?.stop).toBeCloseTo(157.19, 6);
    const end = evs.find((e) => e.state === 'encerrado');
    expect(end?.index).toBe(armIdx + 2);
    expect(end?.exit).toBe('saida-dinamica');
    expect(end?.price).toBeCloseTo(157.19, 6);
  });

  it('modo fixo não muda: a regra dinâmica só vale com exit.mode = dynamic', () => {
    const b = new Bars().trend(80, 1, { range: 1.5 });
    for (let i = 0; i < 4; i++) b.to(b.last.close - 1.5, { range: 1.2 });
    b.add(174, 178, 173.7, 177.5);
    b.add(177.5, 178.5, 175.5, 175.7);
    b.add(175.7, 176, 175.2, 175.5);
    const evs = run(b, ['s91']);
    expect(evs.some((e) => /stop móvel/.test(e.reason))).toBe(false);
  });
});

/** Mercado lateral: oscilação regular sem tendência (MMA50 plana). */
function sideways(n = 160): Bars {
  const b = new Bars();
  for (let i = 0; i < n; i++) b.to(100 + 3 * Math.sin((2 * Math.PI * i) / 16), { range: 1 });
  return b;
}

describe('R1-03 — 9.1 sem filtro de tendência ainda respeita "não operar em lateral"', () => {
  it('trendFilter=false não desliga a regra do ADX/MMA50 plana', () => {
    const b = sideways();
    const noFilters = params((p) => {
      p.s91.trendFilter = false;
      p.s91.lateralFilter = false;
    });
    // a série vira a MME9 para cima várias vezes: sem nenhum filtro, arma
    expect(run(b, ['s91'], noFilters).filter((e) => e.state === 'armado').length).toBeGreaterThan(
      0,
    );
    const pure = params((p) => {
      p.s91.trendFilter = false;
    });
    expect(run(b, ['s91'], pure).filter((e) => e.state === 'armado')).toHaveLength(0);
  });

  it('o motivo registra que o filtro de tendência está desligado e o ADX usado', () => {
    const b = new Bars().trend(80, -1, { range: 1.5 });
    b.add(b.last.close, b.last.close + 7, b.last.close - 0.3, b.last.close + 6.5);
    const pure = params((p) => {
      p.s91.trendFilter = false;
    });
    const armed = run(b, ['s91'], pure).find((e) => e.state === 'armado');
    expect(armed?.reason).toMatch(/sem filtro de tendência/);
    expect(armed?.reason).toMatch(/ADX/);
  });
});

describe('R1-04 — 9.2/9.3: a pernada continua durante o trade', () => {
  /** Alta (+1); referência = candle 59 (F 160, mín. 158,50). Arma em 60; 61 aciona e estopa. */
  function stoppedTrade(): Bars {
    const b = new Bars().trend(60, 1, { range: 1 });
    b.add(160, 160.2, 158.1, 158.3); // 60: fecha abaixo da mínima da referência (arma; stop 158,09)
    b.add(158.3, 160.5, 158.0, 159.6); // 61: aciona em 160,21 e estopa no mesmo candle
    return b;
  }

  it('9.2: depois do stop, a referência segue sendo o maior fechamento da pernada', () => {
    const b = stoppedTrade();
    b.add(159.6, 159.8, 157.9, 158.1); // 62: fecha abaixo da mínima da referência (158,50)
    const e9 = ema(
      b.list.map((c) => c.close),
      9,
    );
    expect(e9[62]! > e9[61]! && e9[61]! > e9[60]!).toBe(true); // MME9 seguiu subindo
    const evs = run(b, ['s92']).filter((e) => e.index >= 60);
    expect(states(evs)).toEqual(['60:armado', '61:acionado', '61:encerrado/stop', '62:armado']);
    expect(evs[3]?.refs).toEqual([59, 62]);
    expect(evs[3]?.trigger).toBeCloseTo(159.81, 6);
    expect(evs[3]?.stop).toBeCloseTo(157.89, 6); // menor mínima da correção desde a referência
  });

  it('9.2: o candle do stop não vira "referência" (variante do achado)', () => {
    const b = stoppedTrade();
    b.add(159.6, 159.8, 157.6, 157.8); // 62
    const evs = run(b, ['s92']).filter((e) => e.index >= 62);
    expect(states(evs)).toEqual(['62:armado']);
    expect(evs[0]?.refs).toEqual([59, 62]);
  });

  it('9.3: fechamentos entre o do candle de saída e o de referência contam', () => {
    const b = new Bars().trend(60, 1, { range: 1 }); // referência: candle 59 (F 160)
    b.add(160, 160.2, 159.2, 159.5); // 60: 1º abaixo
    b.add(159.5, 159.9, 159.1, 159.4); // 61: 2º abaixo — arma (gatilho 159,91, stop 159,09)
    b.add(159.4, 160.0, 159.0, 159.6); // 62: aciona e estopa; fecha abaixo de 160
    b.add(159.6, 159.9, 159.3, 159.7); // 63: abaixo de 160 de novo
    const evs = run(b, ['s93']).filter((e) => e.index >= 60);
    expect(states(evs)).toEqual(['61:armado', '62:acionado', '62:encerrado/stop', '63:armado']);
    expect(evs[3]?.refs).toEqual([59, 63]);
  });

  it('9.3: os fechamentos que armaram uma ocorrência não valem para a próxima (decisão nossa)', () => {
    const b = new Bars().trend(60, 1, { range: 1 });
    b.add(160, 160.2, 159.2, 159.5); // 60
    b.add(159.5, 159.9, 159.1, 159.4); // 61: arma
    b.add(159.4, 160.0, 159.0, 159.6); // 62: aciona e estopa (1º fechamento abaixo depois do trade)
    const evs = run(b, ['s93']).filter((e) => e.index >= 60);
    expect(states(evs)).toEqual(['61:armado', '62:acionado', '62:encerrado/stop']);
  });

  it('9.2: novo maior fechamento durante o trade passa a ser a referência', () => {
    const b = new Bars().trend(60, 1, { range: 1 });
    b.add(160, 160.2, 158.1, 158.3); // 60: arma (gatilho 160,21, stop 158,09)
    b.add(158.3, 161.5, 158.2, 161.2); // 61: aciona; 161,20 é o maior fechamento da pernada
    b.add(161.2, 161.4, 160.0, 160.2); // 62: segue no trade
    b.add(160.2, 160.3, 158.0, 158.1); // 63: estopa e fecha abaixo da mínima de 61 (158,20)
    const evs = run(b, ['s92']).filter((e) => e.index >= 60);
    expect(states(evs)).toEqual(['60:armado', '61:acionado', '63:encerrado/stop', '63:armado']);
    expect(evs[3]?.refs).toEqual([61, 63]);
  });
});
