import { describe, expect, it } from 'vitest';
import { DEFAULT_READINESS, isDisciplined, readiness, type ReadinessTrade } from '../src';

const plan = { released: true } as unknown as NonNullable<ReadinessTrade['plan']>;
const good = (r: number): ReadinessTrade => ({
  r,
  initialStop: 10,
  plan,
  riskPct: 1,
  stopMovedBack: false,
});

const base = {
  current: { initialBalance: 10_000, totalBrl: 3_000, taxBrl: 450, maxDrawdownPct: 8 },
  cdiAcc: 0.1,
  maxRiskPct: 2,
  params: DEFAULT_READINESS,
};

describe('painel de prontidão', () => {
  it('tudo dentro da régua: pronto (mas é régua nossa, não garantia)', () => {
    const trades = Array.from({ length: 120 }, (_, i) => good(i % 2 ? 2 : -1));
    const r = readiness({ ...base, trades });
    expect(r.items.map((x) => x.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(r.ready).toBe(true);
  });

  it('poucos trades, perdendo para o CDI e sem disciplina: aponta cada falta com o número', () => {
    const trades = [
      good(2),
      { ...good(-1), plan: null },
      { ...good(-1), stopMovedBack: true },
      { ...good(1), riskPct: 3.5 },
      { ...good(-1), initialStop: null, r: null, riskPct: null },
    ];
    const r = readiness({
      ...base,
      trades,
      current: { ...base.current, totalBrl: 200, taxBrl: 0, maxDrawdownPct: 25 },
    });
    const by = Object.fromEntries(r.items.map((x) => [x.key, x]));
    expect(r.ready).toBe(false);
    expect(by.amostra!.status).toBe('falta');
    expect(by.amostra!.detail).toMatch(/^5 de 100/);
    expect(by.cdi!.status).toBe('falta'); // 2% contra 10% do CDI
    expect(by.disciplina!.status).toBe('falta');
    expect(by.disciplina!.detail).toMatch(
      /Sem plano: 1; sem stop: 1; stop para trás: 1; risco acima do limite: 1/,
    );
    expect(by.queda!.status).toBe('falta');
  });

  it('sem CDI do Banco Central: "sem dados", nunca inventa', () => {
    const r = readiness({ ...base, trades: [good(1)], cdiAcc: null });
    expect(r.items.find((x) => x.key === 'cdi')!.status).toBe('sem-dados');
    expect(r.ready).toBe(false);
  });

  it('IR pode virar o resultado: positivo em R mas negativo depois do imposto não passa', () => {
    const r = readiness({
      ...base,
      trades: [good(0.1)],
      current: { ...base.current, totalBrl: 100, taxBrl: 150 },
    });
    expect(r.items.find((x) => x.key === 'expectativa')!.status).toBe('falta');
  });

  it('disciplina: risco não medido (antes de reiniciar) não reprova, risco acima do limite reprova', () => {
    expect(isDisciplined({ ...good(1), riskPct: null }, 2)).toBe(true);
    expect(isDisciplined({ ...good(1), riskPct: 2.01 }, 2)).toBe(false);
    expect(isDisciplined({ ...good(1), riskPct: 2 }, 2)).toBe(true);
  });
});
