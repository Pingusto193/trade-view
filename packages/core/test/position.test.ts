import { describe, expect, it } from 'vitest';
import { positionSize, riskPctWarnings } from '../src';

const B3 = { lotSize: 100, minQty: 1, qtyStep: 1, pointValue: 1, fractional: true };

describe('calculadora de posição (exemplos dos vídeos, SPEC §19)', () => {
  it('R$ 100.000, risco 2%, entrada 50, stop 47 → R$ 2.000 de risco e 666 ações (600 + 66)', () => {
    const r = positionSize({ capital: 100_000, riskPct: 2, entry: 50, stop: 47, ...B3 });
    expect(r.riskBudget).toBe(2000);
    expect(r.quantity).toBe(666);
    expect(r.standardLots).toBe(6);
    expect(r.standardQty).toBe(600);
    expect(r.fractionalQty).toBe(66);
    expect(r.maxLoss).toBe(1998);
    expect(r.side).toBe('long');
  });

  it('R$ 10.000, risco 3%, stop de 8% → R$ 300 de risco e R$ 3.750 alocados', () => {
    const r = positionSize({ capital: 10_000, riskPct: 3, entry: 10, stop: 9.2, ...B3 });
    expect(r.riskBudget).toBe(300);
    expect(r.allocated).toBeCloseTo(3750, 6);
  });

  it('sem fracionário, arredonda para o lote padrão', () => {
    const r = positionSize({
      capital: 100_000,
      riskPct: 2,
      entry: 50,
      stop: 47,
      ...B3,
      fractional: false,
    });
    expect(r.quantity).toBe(600);
  });

  it('venda (stop acima) e R:R com alvo; avisa R:R abaixo de 2', () => {
    const r = positionSize({
      capital: 10_000,
      riskPct: 1,
      entry: 20,
      stop: 21,
      target: 18.5,
      ...B3,
    });
    expect(r.side).toBe('short');
    expect(r.quantity).toBe(100);
    expect(r.rr).toBeCloseTo(1.5);
    expect(r.gainAtTarget).toBeCloseTo(150);
    expect(r.warnings.join(' ')).toMatch(/abaixo do mínimo de 2R/);
  });

  it('mini-índice: valor do ponto R$ 0,20', () => {
    // stop de 300 pontos = R$ 60 por contrato; R$ 20.000 × 1% = R$ 200 → 3 contratos
    const r = positionSize({
      capital: 20_000,
      riskPct: 1,
      entry: 130_000,
      stop: 129_700,
      lotSize: 1,
      minQty: 1,
      qtyStep: 1,
      pointValue: 0.2,
    });
    expect(r.riskPerUnit).toBeCloseTo(60);
    expect(r.quantity).toBe(3);
    expect(r.allocated).toBeCloseTo(78_000); // nocional, maior que o capital
    expect(r.warnings.join(' ')).toMatch(/alavancagem/);
  });

  it('cripto com passo de 0,00001', () => {
    const r = positionSize({
      capital: 10_000,
      riskPct: 1,
      entry: 60_000,
      stop: 58_000,
      lotSize: 0.00001,
      minQty: 0.00001,
      qtyStep: 0.00001,
      pointValue: 1,
    });
    expect(r.quantity).toBe(0.05);
  });

  it('quando nem a quantidade mínima cabe no risco, zera e avisa', () => {
    const r = positionSize({ capital: 1_000, riskPct: 1, entry: 100, stop: 50, ...B3 });
    expect(r.quantity).toBe(0);
    expect(r.warnings[0]).toMatch(/nem a quantidade mínima/);
  });

  it('stop igual à entrada é erro', () => {
    expect(() => positionSize({ capital: 1, riskPct: 1, entry: 1, stop: 1, ...B3 })).toThrow();
  });

  it('avisos de % de risco', () => {
    expect(riskPctWarnings(1, 2)).toEqual([]);
    expect(riskPctWarnings(2.5, 3)[0]).toMatch(/acima de 2%/);
    expect(riskPctWarnings(4, 3)[0]).toMatch(/passa do seu limite/);
  });
});
