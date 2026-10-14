import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  FundamentalsTimeline,
  computeFundamentals,
  detectSetups,
  runBacktest,
  type FundamentalFact,
} from '../src';

/**
 * Fundamentos (ADR-0024): fatos anuais escritos à mão. Datas em ISO (AAAA-MM-DD) → meia-noite UTC.
 * "doc" = documento que publicou o valor; "filed" = data em que ficou público.
 */
const D = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const DAY = 86_400_000;

function fact(
  metric: FundamentalFact['metric'],
  end: string,
  value: number,
  doc: string,
  filed: string | null,
  o: { start?: string; concept?: string; rank?: number } = {},
): FundamentalFact {
  const e = D(end);
  return {
    metric,
    concept: o.concept ?? (metric === 'eps' ? 'EarningsPerShareBasic' : 'Revenues'),
    rank: o.rank ?? 0,
    start: o.start ? D(o.start) : e - 364 * DAY,
    end: e,
    value,
    doc,
    filed: filed === null ? null : D(filed),
  };
}

/** Um 10-K por ano com 3 exercícios (o do ano e dois comparativos), como na SEC. */
function tenK(
  docYear: number,
  eps: [number, number, number],
  rev: [number, number, number],
): FundamentalFact[] {
  const doc = `10-K-${docYear}`;
  const filed = `${docYear + 1}-02-15`;
  const out: FundamentalFact[] = [];
  for (let k = 0; k < 3; k++) {
    const y = docYear - 2 + k;
    out.push(fact('eps', `${y}-12-31`, eps[k]!, doc, filed, { start: `${y}-01-01` }));
    out.push(fact('revenue', `${y}-12-31`, rev[k]!, doc, filed, { start: `${y}-01-01` }));
  }
  return out;
}

const AS_OF = D('2026-10-13');
/** Para séries que terminam em 2024 (senão o dado já estaria velho em 2026). */
const MID_2025 = D('2025-06-01');
const fu = (facts: FundamentalFact[], asOf = AS_OF, strict = false) =>
  computeFundamentals(facts, { source: 'teste', asOf, strict });

describe('crescimento do LPA em 2 anos (anual composto) e receita sem queda', () => {
  it('positivo: LPA 1,00 → 1,30 → 1,69 = 30% a.a.; receita 100 → 110 → 120 sem queda', () => {
    const r = fu(tenK(2025, [1, 1.3, 1.69], [100, 110, 120]));
    expect(r.epsGrowth2y).toBeCloseTo(0.3, 8);
    expect(r.revenueNoDecline).toBe(true);
    expect(r.epsNegative).toBeUndefined();
    expect(r.periodEnd).toBe(D('2025-12-31'));
    expect(r.filedAt).toBe(D('2026-02-15'));
    expect(r.notes).toBeUndefined();
  });

  it('20% exatos não viram 19,999…% por arredondamento (o filtro usa ≥ 20%)', () => {
    const r = fu(tenK(2025, [1.1, 1.25, 1.584], [1, 1, 1]));
    expect(r.epsGrowth2y).toBe(0.2);
  });

  it('negativo: LPA cresce 10% a.a. (fraco, mas verificado) e receita cai no último ano', () => {
    const r = fu(tenK(2025, [1, 1.1, 1.21], [100, 120, 119]));
    expect(r.epsGrowth2y).toBeCloseTo(0.1, 8);
    expect(r.revenueNoDecline).toBe(false);
    expect(r.notes).toEqual(['Receita: receita caiu em 2025.']);
  });

  it('receita igual de um ano para o outro não é queda; queda no ano anterior também conta', () => {
    expect(fu(tenK(2025, [1, 1, 1], [100, 100, 100])).revenueNoDecline).toBe(true);
    const r = fu(tenK(2025, [1, 1, 1], [100, 90, 130]));
    expect(r.revenueNoDecline).toBe(false);
    expect(r.notes).toEqual(['Receita: receita caiu em 2024.']);
  });

  it('borda: LPA do último ano negativo = prejuízo, critério FALHA (não é "não verificado")', () => {
    const r = fu(tenK(2025, [1, 0.5, -0.2], [100, 110, 120]));
    expect(r.epsGrowth2y).toBeNull();
    expect(r.epsNegative).toBe(true);
    expect(r.notes?.[0]).toMatch(/LPA de 2025 negativo ou zero \(prejuízo\)/);
    expect(fu(tenK(2025, [1, 0.5, 0], [100, 110, 120])).epsNegative).toBe(true);
  });

  it('borda: LPA negativo no ponto de partida = crescimento composto não se aplica (nulo)', () => {
    const r = fu(tenK(2025, [-0.5, 0.2, 0.8], [100, 110, 120]));
    expect(r.epsGrowth2y).toBeNull();
    expect(r.epsNegative).toBeUndefined();
    expect(r.notes?.[0]).toMatch(
      /LPA de 2023 negativo ou zero: o crescimento composto não se aplica/,
    );
  });

  it('borda: prejuízo só no ano do meio não impede a conta (só as pontas importam)', () => {
    const r = fu(tenK(2025, [1, -0.3, 1.44], [100, 110, 120]));
    expect(r.epsGrowth2y).toBeCloseTo(0.2, 8);
  });

  it('borda: menos de 2 anos de dados → nulo; com 2 exercícios, queda de receita já é verificável', () => {
    const two = [
      fact('eps', '2024-12-31', 1, 'a', '2025-02-15', { start: '2024-01-01' }),
      fact('eps', '2025-12-31', 2, 'b', '2026-02-15', { start: '2025-01-01' }),
      fact('revenue', '2024-12-31', 100, 'b', '2026-02-15', { start: '2024-01-01' }),
      fact('revenue', '2025-12-31', 120, 'b', '2026-02-15', { start: '2025-01-01' }),
    ];
    const r = fu(two);
    expect(r.epsGrowth2y).toBeNull();
    expect(r.revenueNoDecline).toBeNull();
    expect(r.notes).toEqual([
      'LPA: menos de 3 exercícios anuais seguidos (histórico curto ou troca de ano fiscal).',
      'Receita: menos de 3 exercícios anuais seguidos (histórico curto ou troca de ano fiscal).',
    ]);
    two[3] = { ...two[3]!, value: 90 };
    expect(fu(two).revenueNoDecline).toBe(false);
  });

  it('borda: troca de ano fiscal (setembro → dezembro) quebra a sequência → nulo', () => {
    const facts = [
      fact('eps', '2022-09-30', 1, 'k22', '2022-11-20', { start: '2021-10-01' }),
      fact('eps', '2023-09-30', 1.2, 'k23', '2023-11-20', { start: '2022-10-01' }),
      // período de transição de 3 meses (10-KT): não é exercício anual
      fact('eps', '2023-12-31', 0.3, 'kt', '2024-03-01', { start: '2023-10-01' }),
      fact('eps', '2024-12-31', 1.5, 'k24', '2025-02-20', { start: '2024-01-01' }),
    ];
    const r = fu(facts, MID_2025);
    expect(r.epsGrowth2y).toBeNull();
    expect(r.notes?.[0]).toMatch(/troca de ano fiscal/);
    // se o documento novo trouxer os anos anteriores refeitos no calendário novo, a conta volta
    const recast = [
      ...facts,
      fact('eps', '2022-12-31', 1, 'k24', '2025-02-20', { start: '2022-01-01' }),
      fact('eps', '2023-12-31', 1.2, 'k24', '2025-02-20', { start: '2023-01-01' }),
    ];
    expect(fu(recast, MID_2025).epsGrowth2y).toBeCloseTo(Math.sqrt(1.5) - 1, 8);
  });

  it('borda: anos de 52/53 semanas (fim em datas diferentes) contam como exercícios seguidos', () => {
    const facts = [
      fact('eps', '2023-09-30', 1, 'k', '2025-11-01', { start: '2022-10-02' }),
      fact('eps', '2024-09-28', 1.1, 'k', '2025-11-01', { start: '2023-10-01' }),
      fact('eps', '2025-09-27', 1.21, 'k', '2025-11-01', { start: '2024-09-29' }),
    ];
    expect(fu(facts).epsGrowth2y).toBeCloseTo(0.1, 8);
  });

  it('borda: lucro trimestral e acumulados de 9 meses não entram (só exercícios anuais)', () => {
    const quarters = [
      fact('eps', '2025-03-31', 0.4, 'q1', '2025-05-01', { start: '2025-01-01' }),
      fact('eps', '2025-06-30', 0.5, 'q2', '2025-08-01', { start: '2025-04-01' }),
      fact('eps', '2025-09-30', 1.2, 'q3', '2025-11-01', { start: '2025-01-01' }), // 9 meses
    ];
    const only = fu(quarters);
    expect(only.epsGrowth2y).toBeNull();
    expect(only.notes?.[0]).toBe('LPA: a fonte não tem LPA anual deste ativo.');
    // com os anuais, os trimestres mais recentes não mudam o "último exercício"
    const mix = fu([...tenK(2024, [1, 1.3, 1.69], [1, 2, 3]), ...quarters], MID_2025);
    expect(mix.epsGrowth2y).toBeCloseTo(0.3, 8);
    expect(mix.periodEnd).toBe(D('2024-12-31'));
  });

  it('desdobramento: usa as razões de dentro do mesmo documento (comparativos refeitos)', () => {
    // relatório do exercício 2023 (entregue em 02/2024): LPA 2,00 (2022) e 2,40 (2023). Desdobramento
    // 1→2 em 2024: o relatório de 2024 refaz 2023 por ação (1,20) e traz 2024 (1,44), mas não 2022
    const facts = [
      fact('eps', '2022-12-31', 2, 'k2023', '2024-02-15', { start: '2022-01-01' }),
      fact('eps', '2023-12-31', 2.4, 'k2023', '2024-02-15', { start: '2023-01-01' }),
      fact('eps', '2023-12-31', 1.2, 'k2024', '2025-02-15', { start: '2023-01-01' }),
      fact('eps', '2024-12-31', 1.44, 'k2024', '2025-02-15', { start: '2024-01-01' }),
    ];
    // ponta a ponta daria √(1,44 ÷ 2) − 1 < 0; encadeado: 2,4/2 × 1,44/1,2 = 1,44 → 20% a.a.
    const r = fu(facts, MID_2025);
    expect(r.epsGrowth2y).toBeCloseTo(0.2, 8);
    expect(r.notes).toEqual(['Receita: a fonte não tem receita anual deste ativo.']);
  });

  it('reapresentação: o valor publicado depois vence (antes dele, vale o original)', () => {
    const base = tenK(2025, [1, 1.3, 1.69], [100, 110, 120]);
    const amended = fact('revenue', '2025-12-31', 105, '10-K/A', '2026-06-01', {
      start: '2025-01-01',
    });
    expect(fu([...base, amended]).revenueNoDecline).toBe(false);
    expect(fu([...base, amended], D('2026-05-01')).revenueNoDecline).toBe(true);
  });

  it('conta preferida: com duas tags cobrindo os mesmos anos, usa a de menor rank', () => {
    const a = tenK(2025, [1, 1, 1], [100, 110, 120]).filter((f) => f.metric === 'revenue');
    const b = a.map((f) => ({ ...f, concept: 'SalesRevenueNet', rank: 1, value: 300 - f.value }));
    expect(fu([...b, ...a]).revenueNoDecline).toBe(true);
    expect(fu([...a.map((f) => ({ ...f, rank: 2 })), ...b]).revenueNoDecline).toBe(false);
  });

  it('dado velho demais (último exercício há mais de ~18 meses) = desatualizado, nulo', () => {
    const r = fu(tenK(2022, [1, 1.3, 1.69], [100, 110, 120]));
    expect(r.epsGrowth2y).toBeNull();
    expect(r.revenueNoDecline).toBeNull();
    expect(r.notes?.[0]).toMatch(/terminou em 31\/12\/2022: dado desatualizado/);
  });

  it('sem nada: tudo nulo, com o motivo', () => {
    const r = fu([]);
    expect(r).toMatchObject({ epsGrowth2y: null, revenueNoDecline: null, source: 'teste' });
    expect(r.notes).toHaveLength(2);
  });
});

describe('sem look-ahead: só balanços publicados antes do candle', () => {
  const facts = [
    ...tenK(2023, [1, 1.1, 1.21], [100, 110, 120]), // publicado em 15/02/2024: 10% a.a.
    ...tenK(2024, [1.1, 1.21, 1.75], [110, 120, 130]), // publicado em 15/02/2025: ~20% a.a.
  ];

  it('modo estrito: o documento publicado num dia só vale a partir do dia seguinte', () => {
    expect(fu(facts, D('2025-02-15'), true).epsGrowth2y).toBeCloseTo(0.1, 8);
    expect(fu(facts, D('2025-02-16'), true).epsGrowth2y).toBeCloseTo(Math.sqrt(1.75 / 1.1) - 1, 8);
    // fora do modo estrito (hoje), o publicado no próprio dia já conta
    expect(fu(facts, D('2025-02-15')).epsGrowth2y).toBeCloseTo(Math.sqrt(1.75 / 1.1) - 1, 8);
  });

  it('linha do tempo: antes do primeiro balanço não há fundamentos; datas desconhecidas ficam de fora', () => {
    const undated = fact('eps', '2025-12-31', -1, 'x', null, { start: '2025-01-01' });
    const tl = new FundamentalsTimeline([...facts, undated], 'teste');
    expect(tl.undated).toBe(1);
    expect(tl.firstFiled).toBe(D('2024-02-15'));
    expect(tl.at(D('2024-02-15')).epsGrowth2y).toBeNull();
    expect(tl.at(D('2024-02-15')).notes).toEqual(['Nenhum balanço publicado antes desta data.']);
    expect(tl.at(D('2024-02-16')).epsGrowth2y).toBeCloseTo(0.1, 8);
    expect(tl.at(D('2025-02-16')).epsGrowth2y).toBeCloseTo(Math.sqrt(1.75 / 1.1) - 1, 8);
    // o fato sem data (prejuízo) nunca entra no laboratório
    expect(tl.at(D('2026-10-01')).epsNegative).toBeUndefined();
    // e o mesmo dado envelhece com o tempo
    expect(tl.at(D('2026-08-01')).epsGrowth2y).toBeNull();
  });

  it('acrescentar balanços FUTUROS não muda nenhum valor do passado', () => {
    const tl1 = new FundamentalsTimeline(facts, 'teste');
    const future = tenK(2025, [1.21, 1.75, -3], [120, 130, 10]);
    const tl2 = new FundamentalsTimeline([...facts, ...future], 'teste');
    for (let t = D('2024-01-01'); t <= D('2026-02-15'); t += 7 * DAY)
      expect(tl2.at(t)).toEqual(tl1.at(t));
    expect(tl2.at(D('2026-02-16')).epsNegative).toBe(true);
  });
});

describe('fundamentos que mudam com o tempo no motor e no backtest', () => {
  /** Semanal: alta, queda de ~64% e pivô de alta (mesma série dos testes da reflexividade). */
  function weekly() {
    const out: Candle[] = [];
    let p = 60;
    let t = D('2020-01-06');
    const push = (o: number, h: number, l: number, c: number) => {
      out.push({ time: t, open: o, high: h, low: l, close: c, volume: 1000 });
      t += 7 * DAY;
      p = c;
    };
    for (let i = 0; i < 60; i++) push(p, p + 2, p - 1, p + 1);
    for (let i = 0; i < 40; i++) {
      const c = p * 0.975;
      push(p, p + 0.75, c - 0.75, c);
    }
    for (const c of [62, 60, 61, 64, 67, 66, 64])
      push(p, Math.max(p, c) + 0.6, Math.min(p, c) - 0.6, c);
    push(64, 64.3, 62, 63);
    push(63, 65.5, 62.8, 65.2);
    push(65.2, 68.5, 64.8, 68.2);
    for (const c of [72, 75, 78]) push(p, Math.max(p, c) + 0.6, Math.min(p, c) - 0.6, c);
    return out;
  }

  it('o radar só considera os fundamentos publicados até cada candle', () => {
    const candles = weekly();
    const radarAt = detectSetups(candles, { only: ['reflexivity'], tick: 0.01 }).find(
      (e) => e.state === 'radar',
    )!;
    const t = candles[radarAt.index]!.time;
    const weak = { epsGrowth2y: 0.01, revenueNoDecline: true, source: 'teste' };
    const strong = { epsGrowth2y: 0.4, revenueNoDecline: true, source: 'teste' };
    // fracos até o candle do radar, fortes depois: o radar daquele candle não acontece
    const late = detectSetups(candles, {
      only: ['reflexivity'],
      tick: 0.01,
      fundamentalsAt: (time) => (time <= t ? weak : strong),
    });
    expect(late.find((e) => e.state === 'radar')?.index ?? -1).toBeGreaterThan(radarAt.index);
    // fortes já antes: radar no mesmo candle, com "possível distorção"
    const early = detectSetups(candles, {
      only: ['reflexivity'],
      tick: 0.01,
      fundamentalsAt: () => strong,
    }).find((e) => e.state === 'radar')!;
    expect(early.index).toBe(radarAt.index);
    expect(early.reason).toMatch(/possível distorção/);
  });

  it('backtest repassa os fundamentos por candle ao motor', () => {
    const candles = weekly();
    const meta = {
      tick: 0.01,
      pointValue: 1,
      lotSize: 1,
      minQty: 1,
      qtyStep: 1,
      market: 'us' as const,
    };
    const cfg = {
      setups: ['reflexivity'] as const,
      tf: '1w' as const,
      tz: 'UTC',
      meta,
      capital: 10_000,
      riskPct: 1,
    };
    const asked: number[] = [];
    runBacktest(candles, {
      ...cfg,
      fundamentalsAt: (time) => {
        asked.push(time);
        return { epsGrowth2y: -0.5, revenueNoDecline: false, source: 'teste' };
      },
    });
    expect(asked.length).toBe(candles.length);
    expect(asked.every((x, i) => x === candles[i]!.time)).toBe(true);
  });
});
