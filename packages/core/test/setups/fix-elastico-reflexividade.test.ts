import { describe, expect, it } from 'vitest';
import { bollinger, detectSetups, type EngineOptions, type SetupEvent } from '../../src';
import { Bars, params, run, states } from './helpers';

/** Série lateral com ruído pequeno e alternado (Bollinger estreita), como em others.test.ts. */
function flat(n = 40): Bars {
  const b = new Bars();
  for (let i = 0; i < n; i++) {
    const c = i % 2 ? 100.5 : 99.5;
    b.add(c === 100.5 ? 99.5 : 100.5, Math.max(c, 100) + 0.3, Math.min(c, 100) - 0.3 - 0.2, c);
  }
  return b;
}

/** Bollinger 20/3 do último candle da série. */
const band = (b: Bars) =>
  bollinger(
    b.list.map((c) => c.close),
    20,
    3,
  ).at(-1)!;

const bySide = (evs: SetupEvent[], from: number, side: 'buy' | 'sell' = 'buy') =>
  evs.filter((e) => e.index >= from && e.side === side);

/**
 * Fecha fora com mínima 96,5 (gatilho 99,61, stop da SPEC 96,49); o candle seguinte não rompe, faz
 * mínima 93,5 e passa o gatilho para 97,06; o terceiro aciona em 97,06 sem tocar o stop.
 */
function outsideThenLowerLow(): { b: Bars; out: number } {
  const b = flat();
  b.add(99.5, 99.6, 96.5, 97);
  const out = b.n - 1;
  expect(97).toBeLessThan(band(b).lower);
  b.add(97, 97.05, 93.5, 95);
  b.add(96.6, 97.5, 96.55, 97.3);
  return { b, out };
}

/** Queda forte que abriu acima da média e fechou fora (gatilho 101,01 acima da média ~99,8). */
function bigDrop(): { b: Bars; out: number } {
  const b = flat();
  b.add(100.5, 101, 94, 95);
  const out = b.n - 1;
  const bb = band(b);
  expect(95).toBeLessThan(bb.lower);
  expect(101.01).toBeGreaterThan(bb.middle);
  return { b, out };
}

describe('R2-06 — Elástico: sem espaço até a média central não vira compra nem "alvo" com perda', () => {
  it('gatilho na média ou acima dela não arma; se o preço voltar à média, cancela', () => {
    const { b, out } = bigDrop();
    b.add(95, 101.5, 94.8, 100.2); // passa pela média (e pela máxima do candle que fechou fora)
    b.add(100.2, 100.5, 99.5, 99.9);
    const evs = bySide(run(b, ['elastic']), out);
    expect(states(evs)).toEqual([`${out}:radar`, `${out + 1}:encerrado/cancelado`]);
    expect(evs[0]?.notes?.join(' ')).toMatch(/sem espaço até a média/i);
    expect(evs.some((e) => e.exit === 'alvo' && (e.resultR ?? 0) < 0)).toBe(false);
  });

  it('caso típico: o gatilho passa para a máxima do candle seguinte, abaixo da média, e opera', () => {
    const { b, out } = bigDrop();
    b.add(95, 96, 94.5, 95.5); // fica abaixo da média: gatilho 96,01
    b.add(95.6, 96.8, 95.5, 96.6); // rompe 96,01
    const evs = bySide(run(b, ['elastic']), out);
    expect(states(evs)).toEqual([`${out}:radar`, `${out + 1}:armado`, `${out + 2}:acionado`]);
    expect(evs[1]?.trigger).toBeCloseTo(96.01, 6);
    expect(evs[1]?.stop).toBeCloseTo(93.99, 6); // abaixo da mínima do candle que fechou fora
    const entry = evs[2]!;
    expect(entry.entry).toBeCloseTo(96.01, 6);
    expect(entry.target!).toBeGreaterThan(entry.entry!);
  });

  it('abriu além da média (gap) na execução: sai no preço de entrada (0R), nunca como "alvo"', () => {
    const b = flat();
    const lower = band(b).lower;
    b.add(99.5, 99.6, lower - 2, lower - 1.5); // fecha fora; máxima abaixo da média
    const out = b.n - 1;
    const mid = band(b).middle;
    expect(99.61).toBeLessThan(mid);
    b.add(mid + 0.5, mid + 1, mid + 0.3, mid + 0.8); // gap acima do gatilho E da média
    b.add(b.last.close, b.last.close + 0.2, b.last.close - 0.3, b.last.close);
    const evs = bySide(run(b, ['elastic']), out);
    expect(states(evs)).toEqual([
      `${out}:radar`,
      `${out}:armado`,
      `${out + 1}:acionado`,
      `${out + 1}:encerrado/cancelado`,
    ]);
    expect(evs[3]?.price).toBeCloseTo(mid + 0.5, 6);
    expect(evs[3]?.resultR).toBeCloseTo(0, 9);
    expect(evs[3]?.reason).toMatch(/sem espaço até o alvo/);
  });

  it('a média central cai até abaixo da entrada com a posição aberta: saída dinâmica, não "alvo"', () => {
    const { b, out } = bigDrop();
    b.add(95, 96, 94.5, 95.5); // arma em 96,01
    b.add(95.6, 96.8, 95.5, 96.6); // aciona em 96,01 (stop 93,99)
    // o preço fica de lado logo abaixo da entrada, e a MMA20 vai descendo até ele
    for (let i = 0; i < 25; i++) b.add(95.8, 96, 95.5, 95.8);
    const all = bySide(run(b, ['elastic']), out);
    const evs = all.filter((e) => e.id === all[0]?.id);
    const end = evs.at(-1)!;
    expect(end.state).toBe('encerrado');
    expect(end.price!).toBeLessThan(96.01);
    expect(end.resultR!).toBeLessThan(0);
    expect(end.exit).toBe('saida-dinamica');
    expect(end.reason).toMatch(/alvo móvel/);
    expect(evs.some((e) => e.exit === 'alvo')).toBe(false);
  });

  it('venda espelhada: alta forte que abriu abaixo da média não arma no candle que fechou fora', () => {
    const b = flat();
    b.add(99.5, 106, 99, 105.5);
    const out = b.n - 1;
    const bb = band(b);
    expect(105.5).toBeGreaterThan(bb.upper);
    expect(98.99).toBeLessThan(bb.middle);
    b.add(105.5, 106, 104, 104.5); // continua acima da média: gatilho 103,99
    const evs = bySide(run(b, ['elastic']), out, 'sell');
    expect(states(evs)).toEqual([`${out}:radar`, `${out + 1}:armado`]);
    expect(evs[0]?.notes?.join(' ')).toMatch(/sem espaço até a média/i);
    expect(evs[1]?.trigger).toBeCloseTo(103.99, 6);
    expect(evs[1]?.stop).toBeCloseTo(106.01, 6); // acima da máxima do candle que fechou fora
  });
});

describe('R2-07 — Elástico: stop além do extremo do candle que fechou fora (SPEC)', () => {
  it('padrão "outside-bar": o stop fica em 96,49 mesmo com mínima mais baixa no candle seguinte', () => {
    const { b, out } = outsideThenLowerLow();
    const evs = bySide(run(b, ['elastic']), out);
    expect(states(evs)).toEqual([
      `${out}:radar`,
      `${out}:armado`,
      `${out + 1}:armado`,
      `${out + 2}:acionado`,
    ]);
    expect(evs[1]?.stop).toBeCloseTo(96.49, 6);
    expect(evs[2]?.trigger).toBeCloseTo(97.06, 6);
    expect(evs[2]?.stop).toBeCloseTo(96.49, 6);
    expect(evs[3]?.entry).toBeCloseTo(97.06, 6);
    expect(evs[3]?.stop).toBeCloseTo(96.49, 6);
  });

  it('variante "extreme-since": o stop acompanha a menor mínima desde o radar', () => {
    const { b, out } = outsideThenLowerLow();
    const p = params((x) => {
      x.elastic.stopMode = 'extreme-since';
    });
    const evs = bySide(run(b, ['elastic'], p), out);
    expect(evs[2]?.stop).toBeCloseTo(93.49, 6);
    expect(evs[3]?.stop).toBeCloseTo(93.49, 6);
  });

  it('candle inteiro abaixo da mínima do candle que fechou fora: o gatilho não passa para ele', () => {
    const b = flat();
    b.add(97.3, 97.4, 96.5, 97); // gatilho 97,41, stop 96,49
    const out = b.n - 1;
    b.add(96, 96.2, 94, 94.5); // gatilho seria 96,21, abaixo do stop 96,49: fica 97,41
    b.add(94.5, 97.2, 94.4, 97); // não rompe 97,41; gatilho 97,21, acima do stop: passa
    const all = bySide(run(b, ['elastic']), out);
    const evs = all.filter((e) => e.id === all[0]?.id);
    expect(states(evs)).toEqual([`${out}:radar`, `${out}:armado`, `${out + 2}:armado`]);
    expect(evs[2]?.trigger).toBeCloseTo(97.21, 6);
    expect(evs[2]?.stop).toBeCloseTo(96.49, 6);
    for (const e of evs.filter((x) => x.state === 'armado'))
      expect(e.trigger!).toBeGreaterThan(e.stop!);
  });
});

/**
 * Fecha fora sem mínima mais baixa depois (o stop é o mesmo nos dois modos): gatilho 97,41, stop 96,49
 * (risco 0,92; 1R = 98,33, abaixo da média ~99,85). O candle seguinte aciona em 97,41.
 */
function outsideThenEntry(): { b: Bars; out: number } {
  const b = flat();
  b.add(97.3, 97.4, 96.5, 97);
  const out = b.n - 1;
  expect(97).toBeLessThan(band(b).lower);
  b.add(97.2, 97.6, 97.1, 97.5);
  return { b, out };
}

describe('R2-15 — Elástico: a parcial em 1R entra no resultado final', () => {
  const withPartial = params((x) => {
    x.elastic.partialAt1R = true;
  });

  it('parcial em +1R e depois stop: 50% × 1R + 50% × (−1R) = 0R', () => {
    const { b, out } = outsideThenEntry();
    b.add(97.5, 98.4, 97.3, 98); // faz a parcial em 98,33
    b.add(97.8, 97.9, 96.3, 96.4); // stop
    const evs = bySide(run(b, ['elastic'], withPartial), out);
    expect(states(evs)).toEqual([
      `${out}:radar`,
      `${out}:armado`,
      `${out + 1}:acionado`,
      `${out + 2}:acionado`,
      `${out + 3}:encerrado/stop`,
    ]);
    expect(evs[2]?.entry).toBeCloseTo(97.41, 6);
    expect(evs[2]?.stop).toBeCloseTo(96.49, 6);
    expect(evs[3]?.reason).toMatch(/Parcial em 1R/);
    expect(evs[4]?.resultR).toBeCloseTo(0, 6);
    expect(evs[4]?.reason).toMatch(/parcial/);
  });

  it('1R e média no mesmo candle (média além de 1R): parcial primeiro, resto no alvo', () => {
    const { b, out } = outsideThenEntry();
    const target = band(b).middle;
    b.add(97.5, target + 0.5, 97.3, target + 0.3);
    const evs = bySide(run(b, ['elastic'], withPartial), out);
    expect(states(evs).slice(2)).toEqual([
      `${out + 1}:acionado`,
      `${out + 2}:acionado`,
      `${out + 2}:encerrado/alvo`,
    ]);
    const rTarget = (evs[4]!.price! - 97.41) / (97.41 - 96.49);
    expect(rTarget).toBeGreaterThan(1);
    expect(evs[4]?.resultR).toBeCloseTo(0.5 * 1 + 0.5 * rTarget, 6);
  });

  it('1R e stop no mesmo candle: stop primeiro (conservador), sem parcial, −1R', () => {
    const { b, out } = outsideThenEntry();
    b.add(97.5, 98.4, 96.3, 96.4);
    const evs = bySide(run(b, ['elastic'], withPartial), out);
    expect(states(evs).slice(2)).toEqual([`${out + 1}:acionado`, `${out + 2}:encerrado/stop`]);
    expect(evs[3]?.resultR).toBeCloseTo(-1, 6);
  });

  it('sem a parcial ligada, o resultado é o da posição inteira', () => {
    const { b, out } = outsideThenEntry();
    b.add(97.5, 98.4, 97.3, 98);
    b.add(97.8, 97.9, 96.3, 96.4);
    const evs = bySide(run(b, ['elastic']), out);
    expect(states(evs).slice(2)).toEqual([`${out + 1}:acionado`, `${out + 3}:encerrado/stop`]);
    expect(evs[3]?.resultR).toBeCloseTo(-1, 6);
  });
});

/** Série de others.test.ts: alta, queda de ~64%, fundo mais alto e rompimento (radar 87, arma 110). */
function reflexSeries(tail: number[] = [72, 75, 78]): Bars {
  const b = new Bars().trend(60, 1, { range: 2 });
  for (let i = 0; i < 40; i++) b.to(b.last.close * 0.975, { range: 1.5 });
  for (const c of [62, 60, 61, 64, 67, 66, 64]) b.to(c, { range: 1.2 });
  b.add(64, 64.3, 62, 63);
  b.add(63, 65.5, 62.8, 65.2).add(65.2, 68.5, 64.8, 68.2); // pivô de alta em 109
  for (const c of tail) b.to(c, { range: 1.2 });
  return b;
}

const reflex = (b: Bars, opts: EngineOptions = {}) =>
  detectSetups(b.list, { only: ['reflexivity'], tick: 0.01, strict: true, ...opts });

describe('R2-09 — Reflexividade: aviso permanente e fundamentos em todas as fases', () => {
  it('armado, acionado e encerrado levam o aviso de viés de sobrevivência e "fundamentos NÃO verificados"', () => {
    const b = reflexSeries([72, 75, 78, 60]); // aciona em 111 e depois perde o stop
    const all = reflex(b);
    const evs = all.filter((e) => e.id === all[0]?.id);
    expect(states(evs)).toEqual(['87:radar', '110:armado', '111:acionado', '113:encerrado/stop']);
    for (const e of evs) {
      expect(e.notes?.join(' ')).toMatch(/viés de sobrevivência/);
      expect(e.notes?.join(' ')).toMatch(/Fundamentos NÃO verificados/);
    }
    expect(evs[0]?.reason).toMatch(/fundamentos NÃO verificados/);
    expect(evs[0]?.reason).not.toMatch(/possível distorção/);
  });

  it('LPA informado mas receita desconhecida: diz que a receita NÃO foi verificada', () => {
    const evs = reflex(reflexSeries(), {
      fundamentals: { epsGrowth2y: 0.3, revenueNoDecline: null, source: 'SEC EDGAR' },
    });
    const radar = evs.find((e) => e.state === 'radar')!;
    expect(radar.notes?.join(' ')).toMatch(/LPA cresceu 30%/);
    expect(radar.notes?.join(' ')).toMatch(/Receita NÃO verificada/);
    expect(radar.reason).toMatch(/fundamentos verificados só em parte/);
    const armado = evs.find((e) => e.state === 'armado')!;
    expect(armado.notes?.join(' ')).toMatch(/Receita NÃO verificada/);
  });

  it('fundamentos completos e fortes: possível distorção entre preço e valor', () => {
    const evs = reflex(reflexSeries(), {
      fundamentals: { epsGrowth2y: 0.3, revenueNoDecline: true, source: 'SEC EDGAR' },
    });
    const radar = evs.find((e) => e.state === 'radar')!;
    expect(radar.reason).toMatch(/possível distorção/);
    expect(radar.notes?.join(' ')).toMatch(/receita sem queda/i);
  });

  it('receita em queda ou LPA fraco: fundamentos fracos, sem radar', () => {
    expect(
      reflex(reflexSeries(), {
        fundamentals: { epsGrowth2y: 0.3, revenueNoDecline: false, source: 'SEC EDGAR' },
      }),
    ).toEqual([]);
    expect(
      reflex(reflexSeries(), {
        fundamentals: { epsGrowth2y: 0.05, revenueNoDecline: null, source: 'SEC EDGAR' },
      }),
    ).toEqual([]);
  });
});

describe('R2-10 — Reflexividade só no semanal (weeklyOnly)', () => {
  it('no diário não roda; no semanal e sem escala informada roda como antes', () => {
    const b = reflexSeries();
    expect(reflex(b, { tf: '1d' })).toEqual([]);
    expect(reflex(b, { tf: '60m' })).toEqual([]);
    const semTf = states(reflex(b));
    expect(semTf).toEqual(['87:radar', '110:armado', '111:acionado']);
    expect(states(reflex(b, { tf: '1w' }))).toEqual(semTf);
  });

  it('weeklyOnly desligado: roda em qualquer escala (estudo)', () => {
    const p = params((x) => {
      x.reflexivity.weeklyOnly = false;
    });
    expect(states(reflex(reflexSeries(), { tf: '1d', params: p }))).toEqual([
      '87:radar',
      '110:armado',
      '111:acionado',
    ]);
  });
});

describe('R2-12 — Reflexividade: números de "decisão nossa" vêm dos parâmetros', () => {
  it('alvo em R configurável (exit.targetR)', () => {
    const p = params((x) => {
      x.reflexivity.exit = { mode: 'fixed', targetR: 2 };
    });
    const ac = reflex(reflexSeries(), { params: p }).find((e) => e.state === 'acionado')!;
    expect(ac.target).toBeCloseTo(ac.entry! + 2 * (ac.entry! - ac.stop!), 2);
    const padrao = reflex(reflexSeries()).find((e) => e.state === 'acionado')!;
    expect(padrao.target).toBeCloseTo(padrao.entry! + 3 * (padrao.entry! - padrao.stop!), 2);
  });

  it('saída por condução (exit.mode = dynamic): sem alvo; fechou abaixo da MME21 → stop móvel', () => {
    const p = params((x) => {
      x.reflexivity.exit = { mode: 'dynamic', targetR: 3 };
    });
    const b = reflexSeries([72, 75, 78, 74, 69, 66]);
    const all = reflex(b, { params: p });
    const evs = all.filter((e) => e.id === all[0]?.id);
    const ac = evs.find((e) => e.state === 'acionado')!;
    expect(ac.target).toBeNull();
    const trail = evs.find((e) => e.state === 'acionado' && /stop móvel/.test(e.reason));
    expect(trail?.index).toBe(114);
    expect(trail?.stop).toBeCloseTo(b.list[114]!.low - 0.01, 6);
    expect(states(evs).at(-1)).toBe('115:encerrado/saida-dinamica');
  });

  it('validade do radar configurável (radarExpiryBars)', () => {
    const p = params((x) => {
      x.reflexivity.radarExpiryBars = 10;
    });
    const evs = reflex(reflexSeries(), { params: p });
    expect(states(evs).slice(0, 2)).toEqual(['87:radar', '98:encerrado/expirou']);
  });

  it('janela pivô → médias subindo configurável (confirmBars)', () => {
    // pivô em 109; recua 3 candles (MME21 segue caindo) e só volta a subir em 113, 4 candles depois
    const b = reflexSeries([67.5, 67, 66.5, 72]);
    const armou = (confirmBars: number) =>
      reflex(b, {
        params: params((x) => {
          x.reflexivity.confirmBars = confirmBars;
        }),
      }).find((e) => e.state === 'armado')?.index;
    expect(armou(8)).toBe(113);
    expect(armou(4)).toBe(113);
    expect(armou(3)).toBeUndefined();
    expect(armou(2)).toBeUndefined();
  });
});

describe('R2-13 — Reflexividade com topo histórico inclui o 1º candle', () => {
  it('topo do IPO no índice 0: a queda é medida a partir dele', () => {
    const b = new Bars().add(100, 200, 99, 100);
    for (let i = 0; i < 80; i++) b.to(b.last.close * 0.99);
    const p = params((x) => {
      x.reflexivity.peak = 'all';
    });
    const radar = reflex(b, { params: p }).find((e) => e.state === 'radar')!;
    expect(radar.index).toBe(50);
    const dd = 1 - b.list[50]!.close / 200;
    expect(radar.reason).toMatch(new RegExp(`Queda de ${Math.round(dd * 100)}%`));
  });
});
