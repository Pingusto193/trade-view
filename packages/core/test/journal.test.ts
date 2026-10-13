import type { PaperStats } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import { compareJournals, COMPARE_MIN_TRADES } from '../src/journal/compare';
import { RealTradeError, realTaxTrades, realTrade, stopMovedBack } from '../src/journal/real';
import { journalStats, type StatTrade } from '../src/journal/stats';

// 10h em São Paulo (13h UTC) de cada dia
const day = (d: number, h = 13) => Date.UTC(2026, 2, d, h);

describe('realTrade (execuções digitadas pelo usuário)', () => {
  it('compra e venda simples: resultado líquido, R e risco inicial', () => {
    const c = realTrade({
      side: 'long',
      pointValue: 1,
      initialStop: 9,
      fills: [
        { time: day(2), kind: 'entrada', qty: 100, price: 10, feesBrl: 5, fx: 1 },
        { time: day(5), kind: 'saida', qty: 100, price: 12, feesBrl: 5, fx: 1 },
      ],
    });
    expect(c.status).toBe('fechado');
    expect(c.realizedBrl).toBe(190); // 200 − 5 − 5
    expect(c.initialRiskBrl).toBe(100);
    expect(c.r).toBe(1.9);
    expect(c.exits[0]).toMatchObject({ saleBrl: 1200, sameDay: false, resultBrl: 190 });
  });

  it('parcial + entrada adicional: preço médio e taxas de entrada rateadas', () => {
    const c = realTrade({
      side: 'long',
      pointValue: 1,
      initialStop: 18,
      fills: [
        { time: day(2), kind: 'entrada', qty: 100, price: 20, feesBrl: 10, fx: 1 },
        { time: day(3), kind: 'entrada', qty: 100, price: 22, feesBrl: 10, fx: 1 },
        { time: day(4), kind: 'saida', qty: 100, price: 24, feesBrl: 0, fx: 1 },
      ],
    });
    expect(c.status).toBe('aberto');
    expect(c.openQty).toBe(100);
    expect(c.avgEntry).toBe(21);
    expect(c.maxQty).toBe(200);
    // (24 − 21) × 100 − 100 × (20/200)
    expect(c.realizedBrl).toBe(290);
    expect(c.r).toBeNull(); // só com o trade fechado
  });

  it('venda a descoberto e ativo em dólar: resultado em R$ pelo câmbio de cada execução', () => {
    const c = realTrade({
      side: 'short',
      pointValue: 1,
      initialStop: 110,
      fills: [
        { time: day(2), kind: 'entrada', qty: 10, price: 100, feesBrl: 0, fx: 5 },
        { time: day(9), kind: 'saida', qty: 10, price: 90, feesBrl: 0, fx: 5.2 },
      ],
    });
    // vendeu a 100 × 5 = R$ 500 e recomprou a 90 × 5,2 = R$ 468 → +32 por ação
    expect(c.realizedBrl).toBe(320);
    expect(c.initialRiskBrl).toBe(500); // 10 × 10 × 5
    expect(c.r).toBe(0.64);
    expect(c.exits[0]?.saleBrl).toBe(5000); // na venda a descoberto, a venda foi a entrada
  });

  it('mini-índice: valor do ponto entra no resultado', () => {
    const c = realTrade({
      side: 'long',
      pointValue: 0.2,
      initialStop: 129_800,
      fills: [
        { time: day(2, 13), kind: 'entrada', qty: 2, price: 130_000, feesBrl: 1, fx: 1 },
        { time: day(2, 15), kind: 'saida', qty: 2, price: 130_400, feesBrl: 1, fx: 1 },
      ],
    });
    expect(c.realizedBrl).toBe(158); // 400 × 0,2 × 2 − 2
    expect(c.r).toBe(1.98);
    expect(c.exits[0]?.sameDay).toBe(true);
    expect(realTaxTrades(c, 'outro')[0]).toMatchObject({ modality: 'day', assetClass: 'outro' });
  });

  it('borda: saída maior que a posição, valores inválidos, sem stop, sem saída', () => {
    const base = { side: 'long' as const, pointValue: 1, initialStop: null };
    expect(() =>
      realTrade({
        ...base,
        fills: [
          { time: day(2), kind: 'entrada', qty: 10, price: 10, feesBrl: 0, fx: 1 },
          { time: day(3), kind: 'saida', qty: 11, price: 10, feesBrl: 0, fx: 1 },
        ],
      }),
    ).toThrow(RealTradeError);
    expect(() =>
      realTrade({
        ...base,
        fills: [{ time: day(2), kind: 'entrada', qty: 0, price: 10, feesBrl: 0, fx: 1 }],
      }),
    ).toThrow(RealTradeError);
    const open = realTrade({
      ...base,
      fills: [{ time: day(2), kind: 'entrada', qty: 10, price: 10, feesBrl: 0, fx: 1 }],
    });
    expect(open).toMatchObject({ status: 'aberto', r: null, initialRiskBrl: null, closedAt: null });
    const none = realTrade({ ...base, fills: [] });
    expect(none).toMatchObject({ status: 'aberto', avgEntry: null, openedAt: null });
  });
});

describe('stopMovedBack', () => {
  it('compra: stop mais baixo é para trás; venda: mais alto; tirar o stop também', () => {
    expect(stopMovedBack('long', 10, 9)).toBe(true);
    expect(stopMovedBack('long', 10, 11)).toBe(false);
    expect(stopMovedBack('short', 10, 11)).toBe(true);
    expect(stopMovedBack('short', 10, 9)).toBe(false);
    expect(stopMovedBack('long', 10, null)).toBe(true);
    expect(stopMovedBack('long', null, 9)).toBe(false);
  });
});

const t = (realizedBrl: number, r: number | null, extra: Partial<StatTrade> = {}): StatTrade => ({
  realizedBrl,
  feesBrl: 1,
  r,
  hasStop: r !== null,
  stopMovedBack: false,
  planReleased: true,
  ...extra,
});

describe('journalStats', () => {
  it('acerto, R médio, queda máxima e disciplina', () => {
    const s = journalStats(
      [t(100, 1), t(-50, -0.5), t(-50, -0.5, { stopMovedBack: true }), t(200, 2)],
      1000,
    );
    expect(s).toMatchObject({
      trades: 4,
      wins: 2,
      winRate: 0.5,
      avgR: 0.5,
      expectancyBrl: 50,
      totalBrl: 200,
      feesBrl: 4,
      maxDrawdownBrl: 100,
      stopMovedBack: 1,
      disciplinePct: 75,
    });
    expect(s.maxDrawdownPct).toBeCloseTo((100 / 1100) * 100, 2);
  });

  it('sem saldo inicial (diário real): queda só em R$; diário vazio', () => {
    const s = journalStats([t(-30, -1), t(10, 0.3)], null);
    expect(s.maxDrawdownBrl).toBe(30);
    expect(s.maxDrawdownPct).toBe(0);
    expect(journalStats([], null)).toMatchObject({ trades: 0, winRate: null, avgR: null });
  });
});

const stats = (over: Partial<PaperStats>): PaperStats => ({
  ...journalStats([], null),
  trades: COMPARE_MIN_TRADES,
  ...over,
});

describe('compareJournals', () => {
  it('amostra pequena: sem conclusão', () => {
    const r = compareJournals(
      { label: 'treino', stats: stats({ avgR: 1 }) },
      { label: 'real', stats: stats({ trades: 5, avgR: -1 }) },
    );
    expect(r).toEqual({ enough: false, findings: [] });
  });

  it('aponta R, acerto e disciplina bem piores no real', () => {
    const r = compareJournals(
      { label: 'treino', stats: stats({ avgR: 0.5, winRate: 0.5, disciplinePct: 95 }) },
      {
        label: 'real',
        stats: stats({ avgR: 0.1, winRate: 0.3, disciplinePct: 70, stopMovedBack: 4 }),
      },
    );
    expect(r.enough).toBe(true);
    expect(r.findings).toHaveLength(4);
    expect(r.findings[0]).toContain('R médio no real');
  });

  it('diferenças pequenas: nada a apontar', () => {
    const r = compareJournals(
      { label: 'treino', stats: stats({ avgR: 0.5, winRate: 0.5, disciplinePct: 95 }) },
      { label: 'real', stats: stats({ avgR: 0.4, winRate: 0.45, disciplinePct: 90 }) },
    );
    expect(r).toEqual({ enough: true, findings: [] });
  });
});
