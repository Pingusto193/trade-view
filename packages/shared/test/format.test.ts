import { describe, expect, it } from 'vitest';
import {
  formatBRL,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatSessionDate,
  formatVolume,
} from '../src/format';

describe('formatação PT-BR', () => {
  it('formata reais como R$ 1.234,56', () => {
    expect(formatBRL(1234.56)).toBe('R$ 1.234,56');
    expect(formatBRL(-2000)).toBe('-R$ 2.000,00');
    expect(formatBRL(Number.NaN)).toBe('—');
  });

  it('formata números e percentuais com vírgula decimal', () => {
    expect(formatNumber(1234.5678, 2)).toBe('1.234,57');
    expect(formatPercent(0.0125)).toBe('1,25%');
  });

  it('formata volume compacto', () => {
    expect(formatVolume(1_234)).toBe('1,2 mil');
    expect(formatVolume(5_600_000)).toBe('5,6 mi');
    expect(formatVolume(999)).toBe('999');
  });

  it('exibe datas DD/MM/AAAA no fuso de São Paulo', () => {
    // 2026-10-12T02:30Z = 11/10/2026 23:30 em São Paulo (UTC-3, sem horário de verão).
    const t = Date.UTC(2026, 9, 12, 2, 30);
    expect(formatDate(t)).toBe('11/10/2026');
    expect(formatDateTime(t)).toBe('11/10/2026 23:30');
  });

  it('datas de candles diários não sofrem conversão de fuso', () => {
    expect(formatSessionDate(Date.UTC(2026, 9, 12))).toBe('12/10/2026');
  });
});
