import { describe, expect, it } from 'vitest';
import { apurarB3, type TaxTrade } from '../src';

const at = (y: number, m: number, d = 15) => Date.UTC(y, m - 1, d, 15);
const swing = (time: number, saleValue: number, result: number): TaxTrade => ({
  time,
  modality: 'swing',
  assetClass: 'acao',
  saleValue,
  result,
});
const day = (time: number, result: number): TaxTrade => ({
  time,
  modality: 'day',
  assetClass: 'outro',
  saleValue: 0,
  result,
});

describe('IR da B3 — apuração mensal', () => {
  it('swing de ações com vendas até R$ 20 mil: lucro isento, só o IRRF fica guardado', () => {
    const [m] = apurarB3([swing(at(2026, 3), 15_000, 3_000)]);
    expect(m).toMatchObject({ month: '2026-03', exemptMonth: true, due: 0, darf: 0 });
    expect(m!.swing).toMatchObject({ exempt: 3_000, taxable: 0, tax: 0, irrf: 0.75 });
    expect(m!.irrfCarry).toBe(0.75);
    expect(m!.dueMonth).toBe('2026-04');
  });

  it('acima de R$ 20 mil: 15% sobre todo o lucro, menos o IRRF de 0,005% das vendas', () => {
    const [m] = apurarB3([swing(at(2026, 3), 30_000, 3_000)]);
    expect(m!.exemptMonth).toBe(false);
    expect(m!.swing.tax).toBe(450);
    expect(m!.swing.irrf).toBe(1.5);
    expect(m!.darf).toBe(448.5);
  });

  it('prejuízo compensa nos meses seguintes, só na mesma modalidade', () => {
    const r = apurarB3([
      swing(at(2026, 1), 25_000, -1_000),
      day(at(2026, 1), -500),
      swing(at(2026, 2), 25_000, 3_000),
      day(at(2026, 2), 200),
    ]);
    expect(r[0]!.swing.lossCarry).toBe(1_000);
    expect(r[0]!.day.lossCarry).toBe(500);
    // fev: swing 3000 − 1000 = 2000 tributável (15% = 300); day 200 − 200 de prejuízo = 0
    expect(r[1]!.swing).toMatchObject({ lossUsed: 1_000, taxable: 2_000, tax: 300 });
    expect(r[1]!.day).toMatchObject({ lossUsed: 200, taxable: 0, lossCarry: 300 });
    // IRRF: jan 1,25 (sobra) + fev 1,25 + 2 (1% do day) = 4,50
    expect(r[1]!.due).toBe(295.5);
  });

  it('day trade: 20% e IRRF de 1% do lucro', () => {
    const [m] = apurarB3([day(at(2026, 5), 200)]);
    expect(m!.day).toMatchObject({ tax: 40, irrf: 2 });
    expect(m!.darf).toBe(38);
  });

  it('DARF abaixo de R$ 10 acumula para o mês seguinte (inclusive em mês sem operação)', () => {
    const r = apurarB3([day(at(2026, 1), 30), day(at(2026, 3), 30)]);
    expect(r.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(r[0]).toMatchObject({ due: 5.7, darf: 0, pendingBelowMin: 5.7 });
    expect(r[1]).toMatchObject({ due: 0, darf: 0, pendingBelowMin: 5.7 });
    expect(r[2]).toMatchObject({ darf: 11.4, pendingBelowMin: 0 });
  });

  it('o mês é o de São Paulo (operação às 22h de 31/01 é janeiro)', () => {
    const [m] = apurarB3([day(Date.UTC(2026, 1, 1, 1), 100)]);
    expect(m!.month).toBe('2026-01');
  });

  it('ETF/futuros não entram na isenção de ações', () => {
    const [m] = apurarB3([
      {
        time: at(2026, 4),
        modality: 'swing',
        assetClass: 'outro',
        saleValue: 5_000,
        result: 1_000,
      },
    ]);
    expect(m!.exemptMonth).toBe(false);
    expect(m!.swing.tax).toBe(150);
  });
});
