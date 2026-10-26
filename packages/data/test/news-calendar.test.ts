import { describe, expect, it } from 'vitest';
import { ECONOMIC_CALENDAR, NEWS_SOURCES, upcomingEvents } from '../src';

describe('agenda econômica', () => {
  it('ordenada; Copom às 18h30 de Brasília; FOMC às 14h de Nova York (horário de verão ou não)', () => {
    const ts = ECONOMIC_CALENDAR.map((e) => e.at);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    const copom = ECONOMIC_CALENDAR.find((e) => e.id === 'copom-2026-11-04')!;
    expect(new Date(copom.at).toISOString()).toBe('2026-11-04T21:30:00.000Z');
    const fomcOct = ECONOMIC_CALENDAR.find((e) => e.id === 'fomc-2026-10-28')!;
    expect(new Date(fomcOct.at).toISOString()).toBe('2026-10-28T18:00:00.000Z'); // EDT (UTC−4)
    const fomcDec = ECONOMIC_CALENDAR.find((e) => e.id === 'fomc-2026-12-09')!;
    expect(new Date(fomcDec.at).toISOString()).toBe('2026-12-09T19:00:00.000Z'); // EST (UTC−5)
  });

  it('próximos eventos a partir de agora (e os recentes, se pedido)', () => {
    const now = Date.UTC(2026, 9, 28, 19); // 1 h depois do FOMC de 28/10
    expect(upcomingEvents(now, 1)[0]!.id).toBe('copom-2026-11-04');
    expect(upcomingEvents(now, 1, 2 * 3_600_000)[0]!.id).toBe('fomc-2026-10-28');
  });
});

describe('fontes de notícias ligadas', () => {
  it('ids únicos, https, intervalos ≥ 2 min, termos e decisão de resumo por IA declarados', () => {
    const ids = NEWS_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of NEWS_SOURCES) {
      expect(s.url.startsWith('https://'), s.id).toBe(true);
      expect(s.intervalMs, s.id).toBeGreaterThanOrEqual(120_000);
      expect(s.terms.length, s.id).toBeGreaterThan(10);
      expect(typeof s.aiSummary, s.id).toBe('boolean');
    }
    // SEC exige identificação
    expect(NEWS_SOURCES.find((s) => s.id === 'sec-8k')?.requires).toBe('SEC_USER_AGENT');
  });
});
