import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP_PARAMS, type SetupEvent } from '../../src';
import { Bars, params, run, states } from './helpers';

/**
 * Correções da revisão no rompimento de consolidação (SPEC §8.1 e §8.6). Série-base: 70 candles de alta
 * (fecha em 170) e uma caixa de candles laterais com máxima 170,6 e mínima 168,8. O radar nasce no
 * índice 73 com a caixa começando em 65 (inclui o fim da alta): topo 170,75 e base 164,25.
 */
const TOP = 170.75;

function boxAfterTrend(n = 14, v = 600): Bars {
  const b = new Bars().trend(70, 1, { range: 1.5, v: v === 0 ? 0 : 1000 });
  const hi = b.last.close + 0.6;
  for (let i = 0; i < n; i++) b.add(b.last.close, hi, hi - 1.8, i % 2 ? hi - 0.4 : hi - 1.2, v);
  return b;
}

/** Eventos da ocorrência que estava em radar no índice `radarIdx`. */
function occurrence(evs: SetupEvent[], radarIdx = 73): SetupEvent[] {
  const id = evs.find((e) => e.state === 'radar' && e.index === radarIdx)?.id;
  expect(id).toBeDefined();
  return evs.filter((e) => e.id === id);
}

const retest = (patch: (p: ReturnType<typeof params>) => void = () => undefined) =>
  params((p) => {
    p.consolidation.entry = 'retest';
    patch(p);
  });

describe('R2-02: reteste — a ordem que já executou não vira "falso rompimento"', () => {
  it('candle passa no gatilho e fecha dentro da caixa: acionado e stop no mesmo candle', () => {
    const b = boxAfterTrend();
    b.add(b.last.close, 173.8, b.last.close - 0.1, 173.6, 2500); // 84: rompe por fechamento
    b.add(173.6, 173.6, 170.7, 171.5, 900); // 85: reteste → gatilho 173,61, stop 170,69
    b.add(171.5, 174.1, 170.0, 170.1, 900); // 86: passa no gatilho e despenca
    const evs = occurrence(run(b, ['consolidation'], retest()));
    expect(states(evs)).toEqual([
      '73:radar',
      '84:armado',
      '85:armado',
      '86:acionado',
      '86:encerrado/stop',
    ]);
    expect(evs[3]?.entry).toBe(173.61);
    expect(evs[4]?.price).toBe(170.69);
    expect(evs[4]?.resultR).toBeLessThan(0);
  });

  it('executou e fechou dentro sem tocar o stop: segue acionado com alerta de falso rompimento', () => {
    const b = boxAfterTrend();
    b.add(b.last.close, 173.8, b.last.close - 0.1, 173.6, 2500);
    b.add(173.6, 173.6, 170.7, 171.5, 900);
    b.add(171.5, 174.1, 170.72, 170.74, 900); // fecha dentro (≤ topo), mínima acima do stop
    const evs = occurrence(run(b, ['consolidation'], retest()));
    expect(states(evs).slice(3)).toEqual(['86:acionado', '86:acionado']);
    expect(evs[4]?.reason).toMatch(/Falso rompimento/);
  });
});

describe('R2-03: reteste — o stop mais curto não volta para a mínima do candle de rompimento', () => {
  it('gatilho que anda sem acionar mantém o stop abaixo do reteste', () => {
    const b = boxAfterTrend();
    b.add(169.0, 173.8, 168.8, 173.6, 2500); // 84: rompimento abre perto da base
    b.add(173.6, 173.7, 170.8, 171.0, 900); // 85: reteste (mínima 170,8 → stop 170,74)
    b.add(171.0, 171.6, 170.9, 171.4, 900); // 86: não aciona; gatilho passa para 171,61
    b.add(171.4, 172.5, 171.3, 172.2, 900); // 87: aciona
    const evs = occurrence(run(b, ['consolidation'], retest()));
    const retestEv = evs.find((e) => e.state === 'armado' && e.index === 85);
    expect(retestEv?.stop).toBe(170.74);
    const acted = evs.find((e) => e.state === 'acionado');
    expect(acted?.index).toBe(87);
    expect(acted?.entry).toBe(171.61);
    expect(acted?.stop).toBe(170.74); // e não 168,79 (mínima do candle de rompimento)
  });
});

describe('R2-04: a caixa não passa de maxBars candles', () => {
  it('lateral longa: o radar expira ao passar de 40 candles e não fica aberto para sempre', () => {
    const b = boxAfterTrend(90);
    const evs = run(b, ['consolidation']);
    const occ = occurrence(evs);
    const radar = occ[0]!;
    const start = radar.refs![0]!;
    expect(start).toBe(65);
    const end = occ.at(-1)!;
    expect(end.state).toBe('encerrado');
    expect(end.exit).toBe('expirou');
    // 65..104 são 40 candles; o candle 105 fecha dentro e faria a caixa ter 41
    expect(end.index).toBe(start + 40);
    // uma nova caixa não reaproveita candles da consolidação que expirou
    for (const r of evs.filter((e) => e.state === 'radar' && e.index > end.index))
      expect(r.refs![0]!).toBeGreaterThan(end.index);
  });

  it('borda: em qualquer rompimento ou expiração a caixa tem no máximo maxBars candles', () => {
    const seen = { rompeu: 0, expirou: 0 };
    for (const maxBars of [10, 12, 40]) {
      const p = params((q) => {
        q.consolidation.maxBars = maxBars;
        q.consolidation.requireVolume = false;
      });
      for (const n of [maxBars - 2, maxBars + 5, maxBars + 30]) {
        const b = boxAfterTrend(n);
        b.add(b.last.close, b.last.close + 4, b.last.close - 0.1, b.last.close + 3.8, 2500);
        const evs = run(b, ['consolidation'], p);
        for (const r of evs.filter((e) => e.state === 'radar')) {
          const occ = evs.filter((e) => e.id === r.id);
          const next = occ.find((e) => e.index > r.index || e.state !== 'radar');
          if (!next) continue; // ainda em radar no fim da série
          const start = r.refs![0]!;
          // rompimento em t: a caixa é start..t−1; expiração em t: a caixa seria start..t
          const len = next.exit === 'expirou' ? next.index - start + 1 : next.index - start;
          if (next.exit === 'expirou') {
            seen.expirou++;
            expect(len).toBe(maxBars + 1);
          } else {
            if (next.state === 'armado') seen.rompeu++;
            expect(len).toBeLessThanOrEqual(maxBars);
          }
        }
      }
    }
    // o teste não é trivial: houve rompimentos armados e radares expirados
    expect(seen.rompeu).toBeGreaterThan(0);
    expect(seen.expirou).toBeGreaterThan(0);
  });
});

describe('R2-05: topo e base acompanham os candles que fecham dentro da caixa', () => {
  it('pavio acima do topo depois do radar: o rompimento é medido contra o topo novo', () => {
    const b = boxAfterTrend();
    b.add(170.2, 171.6, 169.8, 170.3, 600); // 84: pavio até 171,6, fecha dentro
    b.add(169.6, 171.2, 169.5, 171.1, 2500); // 85: fecha acima de 170,75 mas abaixo de 171,6
    const evs = occurrence(run(b, ['consolidation']));
    expect(evs.some((e) => e.state === 'armado')).toBe(false);
    b.add(171.1, 172.6, 171.0, 172.4, 2500); // 86: fecha acima do topo real
    const evs2 = occurrence(run(b, ['consolidation']));
    const armed = evs2.find((e) => e.state === 'armado');
    expect(armed?.index).toBe(86);
    expect(armed?.reason).toMatch(/171,60/);
  });

  it('o próprio candle do radar entra na caixa', () => {
    const b = new Bars().trend(70, 1, { range: 1.5, v: 1000 });
    const hi = b.last.close + 0.6;
    for (let i = 0; i < 14; i++) {
      const close = i % 2 ? hi - 0.4 : hi - 1.2;
      // o candle 73 (radar) tem pavio até 171,6
      b.add(b.last.close, i === 3 ? 171.6 : hi, hi - 1.8, close, 600);
    }
    b.add(169.6, 171.2, 169.5, 171.1, 2500); // 84: fecha abaixo de 171,6
    const evs = occurrence(run(b, ['consolidation']));
    expect(evs[0]?.reason).toMatch(/171,60/);
    expect(evs.some((e) => e.state === 'armado')).toBe(false);
  });
});

describe('R2-12: tolerância e validade do reteste são parâmetros', () => {
  it('retestAtr: mínima a 0,3 × ATR acima do topo só vale como reteste com tolerância maior', () => {
    const b = boxAfterTrend();
    b.add(b.last.close, 173.8, b.last.close - 0.1, 173.6, 2500);
    b.add(173.6, 173.7, 171.5, 172.0, 900); // mínima ~0,35 × ATR acima do topo
    const def = occurrence(run(b, ['consolidation'], retest()));
    expect(def.filter((e) => e.state === 'armado')).toHaveLength(1);
    const wide = occurrence(
      run(
        b,
        ['consolidation'],
        retest((p) => {
          p.consolidation.retestAtr = 0.5;
        }),
      ),
    );
    expect(wide.filter((e) => e.state === 'armado').map((e) => e.index)).toEqual([84, 85]);
  });

  it('retestExpiryBars: expira depois de N candles sem reteste', () => {
    const b = boxAfterTrend();
    b.add(b.last.close, 173.8, b.last.close - 0.1, 173.6, 2500); // 84
    for (let i = 0; i < 12; i++)
      b.add(b.last.close, b.last.close + 0.9, b.last.close - 0.3, b.last.close + 0.5, 900);
    const def = occurrence(run(b, ['consolidation'], retest())).at(-1)!;
    expect(def.exit).toBe('expirou');
    expect(def.index).toBe(84 + 11);
    const short = occurrence(
      run(
        b,
        ['consolidation'],
        retest((p) => {
          p.consolidation.retestExpiryBars = 3;
        }),
      ),
    ).at(-1)!;
    expect(short.exit).toBe('expirou');
    expect(short.index).toBe(84 + 4);
    expect(short.reason).toMatch(/3 candles/);
  });
});

describe('R2-14: sem dado de volume o Radar não finge ter checado o volume', () => {
  it('radar avisa que o volume está indisponível; rompimento explica por que não confirmou', () => {
    const b = boxAfterTrend(14, 0);
    b.add(b.last.close, 173.8, b.last.close - 0.1, 173.6, 0);
    const evs = occurrence(run(b, ['consolidation']));
    expect(evs[0]?.reason).not.toMatch(/volume contraíd/);
    expect(evs[0]?.reason).toMatch(/volume indisponível/);
    const end = evs.at(-1)!;
    expect(end.exit).toBe('cancelado');
    expect(end.reason).toMatch(/sem dado de volume/);
    expect(end.reason).not.toMatch(/—/);
    const noVol = params((p) => {
      p.consolidation.requireVolume = false;
    });
    const armed = occurrence(run(b, ['consolidation'], noVol)).find((e) => e.state === 'armado');
    expect(armed?.index).toBe(84);
    expect(armed?.reason).toMatch(/sem dado de volume/);
  });
});

describe('R3-04: rompimento e falso rompimento pelas primitivas (pa.breakoutByClose)', () => {
  const wick = (patch: (p: ReturnType<typeof params>) => void = () => undefined) =>
    params((p) => {
      p.pa.breakoutByClose = false;
      patch(p);
    });

  it('pavio acima do topo com fechamento dentro: só rompe se o pavio contar', () => {
    const b = boxAfterTrend();
    b.add(168.9, 173.8, 168.8, 170.5, 2500); // 84: pavio rompe, fecha dentro, corpo grande
    const byClose = occurrence(run(b, ['consolidation']));
    expect(byClose.some((e) => e.state === 'armado')).toBe(false);
    const byWick = occurrence(run(b, ['consolidation'], wick()));
    expect(states(byWick)).toEqual(['73:radar', '84:armado']);
    expect(byWick[1]?.reason).toMatch(/pavio/);
  });

  it('pavio abaixo da base: no modo pavio invalida; por fechamento a caixa só cresce', () => {
    const b = boxAfterTrend();
    b.add(169.4, 170.2, 164.0, 169.8, 600); // 84: pavio abaixo de 164,25, fecha dentro
    expect(states(occurrence(run(b, ['consolidation'])))).toEqual(['73:radar']);
    expect(states(occurrence(run(b, ['consolidation'], wick())))).toEqual([
      '73:radar',
      '84:encerrado/invalidado',
    ]);
  });

  it('empate: fechar exatamente no topo NÃO é rompimento', () => {
    const b = boxAfterTrend();
    b.add(169.0, TOP, 168.9, TOP, 2500);
    expect(states(occurrence(run(b, ['consolidation'])))).toEqual(['73:radar']);
  });

  it('empate: depois do rompimento, fechar exatamente no topo conta como voltar para dentro', () => {
    const b = boxAfterTrend();
    b.add(b.last.close, 173.8, b.last.close - 0.1, 173.6, 2500); // 84: rompe
    b.add(173.7, 174.4, 173.2, 174.0, 900); // 85: entrada na abertura
    b.add(174.0, 174.1, 170.5, TOP, 900); // 86: fecha no topo
    const evs = occurrence(run(b, ['consolidation']));
    expect(states(evs)).toEqual(['73:radar', '84:armado', '85:acionado', '86:acionado']);
    expect(evs[3]?.reason).toMatch(/Falso rompimento/);
  });

  it('falso rompimento no próprio candle da entrada gera o alerta nele', () => {
    const b = boxAfterTrend();
    b.add(b.last.close, 173.8, b.last.close - 0.1, 173.6, 2500); // 84: rompe
    b.add(173.7, 173.9, 170.4, 170.6, 900); // 85: entra na abertura e volta para dentro
    const evs = occurrence(run(b, ['consolidation']));
    expect(states(evs)).toEqual(['73:radar', '84:armado', '85:acionado', '85:acionado']);
    expect(evs[3]?.reason).toMatch(/Falso rompimento/);
  });

  it('reteste: fechar exatamente no topo antes de acionar invalida (falso rompimento)', () => {
    const b = boxAfterTrend();
    b.add(b.last.close, 173.8, b.last.close - 0.1, 173.6, 2500); // 84
    b.add(173.6, 173.6, 170.9, 171.5, 900); // 85: reteste
    b.add(171.5, 172.0, 170.8, TOP, 900); // 86: fecha no topo, sem acionar
    const evs = occurrence(run(b, ['consolidation'], retest()));
    expect(states(evs).at(-1)).toBe('86:encerrado/invalidado');
    expect(evs.at(-1)?.reason).toMatch(/Falso rompimento/);
  });
});

describe('R4-01: entrada no rompimento — alvo arredondado ao tick (ADR-0012)', () => {
  /** Rompe no 84 e compra na abertura do 85 (173,70); stop na base − 1 tick. */
  function brokeOut(): Bars {
    const b = boxAfterTrend();
    b.add(b.last.close, 173.8, b.last.close - 0.1, 173.6, 2500); // 84: rompe por fechamento
    b.add(173.7, 174.4, 173.2, 174.0, 900); // 85: entrada na abertura
    return b;
  }
  const targetR = (r: number) =>
    params((p) => {
      p.consolidation.exit = { mode: 'fixed', targetR: r };
    });

  it('alvo fora da grade vai para o tick mais próximo, e é ele que encerra a operação', () => {
    // risco = 173,70 − 164,24 = 9,46; 1,2R = 11,352 → alvo exato 185,052 → 185,05 no tick de 0,01
    const b = brokeOut();
    b.add(174.0, 185.05, 173.9, 184.0, 900); // 86: máxima exatamente no alvo arredondado
    const evs = occurrence(run(b, ['consolidation'], targetR(1.2)));
    expect(states(evs)).toEqual(['73:radar', '84:armado', '85:acionado', '86:encerrado/alvo']);
    expect(evs[2]?.entry).toBe(173.7);
    expect(evs[2]?.stop).toBe(164.24);
    expect(evs[2]?.target).toBe(185.05);
    expect(evs[3]?.price).toBe(185.05);
    // o R parte do preço real de execução: um pouco abaixo de 1,2 por causa do arredondamento
    expect(evs[3]?.resultR).toBeCloseTo(11.35 / 9.46, 9);
  });

  it('padrão (2R): o alvo é um preço da grade, sem resíduo de ponto flutuante', () => {
    const evs = occurrence(run(brokeOut(), ['consolidation']));
    expect(evs.at(-1)?.state).toBe('acionado');
    expect(evs.at(-1)?.target).toBe(192.62); // e não 192,61999999999995
  });

  it('borda: tick grande (0,5) e entrada fora da grade — alvo arredondado ao tick', () => {
    // stop = 164,25 − 0,5 = 163,75 → 164 (tick mais próximo); 173,70 + 2 × 9,70 = 193,10 → 193
    const evs = occurrence(run(brokeOut(), ['consolidation'], DEFAULT_SETUP_PARAMS, 0.5));
    expect(evs.at(-1)?.stop).toBe(164);
    expect(evs.at(-1)?.target).toBe(193);
  });

  it('mesma regra do reteste: com o mesmo alvo em R, os dois modos ficam na grade', () => {
    const b = boxAfterTrend();
    b.add(b.last.close, 173.8, b.last.close - 0.1, 173.6, 2500); // 84
    b.add(173.6, 173.6, 170.7, 171.5, 900); // 85: reteste → gatilho 173,61, stop 170,69
    b.add(171.5, 174.1, 171.4, 173.9, 900); // 86: aciona no gatilho
    const evs = occurrence(
      run(
        b,
        ['consolidation'],
        retest((p) => {
          p.consolidation.exit = { mode: 'fixed', targetR: 1.2 };
        }),
      ),
    );
    const acted = evs.find((e) => e.state === 'acionado');
    // 173,61 + 1,2 × 2,92 = 177,114 → 177,11
    expect(acted?.target).toBe(177.11);
  });

  it('saída dinâmica (condução): continua sem alvo', () => {
    const p = params((q) => {
      q.consolidation.exit = { mode: 'dynamic', targetR: 1.2 };
    });
    const evs = occurrence(run(brokeOut(), ['consolidation'], p));
    expect(evs.at(-1)?.state).toBe('acionado');
    expect(evs.at(-1)?.target).toBeNull();
  });
});
