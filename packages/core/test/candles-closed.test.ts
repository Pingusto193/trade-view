import type { Candle, Session } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  closedCandles,
  isPeriodClosed,
  isTradingDate,
  lastClosedSession,
  weeklyFromDaily,
} from '../src';

/** Sessão no formato que a fonte informa (dias, horário e feriados vêm da meta, não daqui). */
const B3: Session = {
  timezone: 'America/Sao_Paulo',
  days: [1, 2, 3, 4, 5],
  open: '10:00',
  close: '17:00',
  holidays: ['2026-10-12'],
};
const CRYPTO: Session = { timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6] };

const D = (m: number, d: number) => Date.UTC(2026, m - 1, d);
/** Instante a partir da hora LOCAL de São Paulo (UTC−3 em outubro de 2026, pelo tzdata do Node). */
const brt = (m: number, d: number, h: number, min = 0) => Date.UTC(2026, m - 1, d, h + 3, min);
const utc = (m: number, d: number, h: number, min = 0) => Date.UTC(2026, m - 1, d, h, min);

describe('períodos fechados pela sessão da fonte (scanner sem look-ahead)', () => {
  it('dia de pregão: fins de semana e feriados da sessão não contam', () => {
    expect(isTradingDate(B3, D(10, 9))).toBe(true); // sexta
    expect(isTradingDate(B3, D(10, 10))).toBe(false); // sábado
    expect(isTradingDate(B3, D(10, 12))).toBe(false); // feriado da lista
    expect(isTradingDate(CRYPTO, D(10, 11))).toBe(true); // domingo, cripto
  });

  it('diário da B3 fecha no horário de fechamento da sessão (borda: 16:59 aberto, 17:00 fechado)', () => {
    expect(isPeriodClosed('1d', D(10, 9), B3, brt(10, 9, 16, 59))).toBe(false);
    expect(isPeriodClosed('1d', D(10, 9), B3, brt(10, 9, 17, 0))).toBe(true);
    expect(isPeriodClosed('1d', D(10, 8), B3, brt(10, 9, 11))).toBe(true); // ontem
    expect(isPeriodClosed('1d', D(10, 10), B3, brt(10, 9, 18))).toBe(false); // futuro
  });

  it('semanal da B3: quarta à noite ainda em andamento; sexta depois do fechamento já fechou', () => {
    const week = D(10, 5); // segunda
    expect(isPeriodClosed('1w', week, B3, brt(10, 7, 18))).toBe(false);
    expect(isPeriodClosed('1w', week, B3, brt(10, 9, 16, 59))).toBe(false);
    expect(isPeriodClosed('1w', week, B3, brt(10, 9, 17))).toBe(true);
    expect(isPeriodClosed('1w', week, B3, brt(10, 10, 12))).toBe(true); // sábado
  });

  it('mensal: fecha no último pregão do mês (30/10/2026 é sexta; 31 é sábado)', () => {
    expect(isPeriodClosed('1M', D(10, 1), B3, brt(10, 30, 16))).toBe(false);
    expect(isPeriodClosed('1M', D(10, 1), B3, brt(10, 30, 17, 30))).toBe(true);
    expect(isPeriodClosed('1M', D(9, 1), B3, brt(10, 2, 12))).toBe(true);
  });

  it('cripto (24 h): o dia só fecha à meia-noite UTC e a semana na virada de domingo para segunda', () => {
    expect(isPeriodClosed('1d', D(10, 13), CRYPTO, utc(10, 13, 23, 59))).toBe(false);
    expect(isPeriodClosed('1d', D(10, 13), CRYPTO, utc(10, 14, 0))).toBe(true);
    expect(isPeriodClosed('1w', D(10, 12), CRYPTO, utc(10, 18, 23, 59))).toBe(false);
    expect(isPeriodClosed('1w', D(10, 12), CRYPTO, utc(10, 19, 0))).toBe(true);
  });

  it('intradiário: fecha quando o relógio passa do fim do balde', () => {
    const t = utc(10, 13, 10);
    expect(isPeriodClosed('15m', t, CRYPTO, t + 15 * 60_000 - 1)).toBe(false);
    expect(isPeriodClosed('15m', t, CRYPTO, t + 15 * 60_000)).toBe(true);
  });

  it('último pregão fechado: pula o feriado e o pregão em andamento', () => {
    // segunda 12/10 é feriado: às 18h o último fechado é sexta 09/10
    expect(lastClosedSession(B3, brt(10, 12, 18))).toBe(D(10, 9));
    // terça durante o pregão: ainda sexta; depois do fechamento: a própria terça
    expect(lastClosedSession(B3, brt(10, 13, 12))).toBe(D(10, 9));
    expect(lastClosedSession(B3, brt(10, 13, 17, 30))).toBe(D(10, 13));
    expect(lastClosedSession(B3, brt(10, 10, 9))).toBe(D(10, 9)); // sábado
    expect(lastClosedSession(CRYPTO, utc(10, 13, 10))).toBe(D(10, 12));
  });

  it('closedCandles corta o candle em formação e os futuros; weeklyFromDaily deixa a semana aberta de fora', () => {
    const daily: Candle[] = [5, 6, 7, 8, 9, 12, 13, 14].map((d, i) => ({
      time: D(10, d),
      open: 10 + i,
      high: 11 + i,
      low: 9 + i,
      close: 10.5 + i,
      volume: 100,
    }));
    // quarta 14/10 às 15h: o candle de quarta está em formação
    const now = brt(10, 14, 15);
    const closed = closedCandles(daily, '1d', B3, now);
    expect(closed.map((c) => c.time)).toEqual(daily.slice(0, -1).map((c) => c.time));
    const weekly = weeklyFromDaily(closed, B3, now);
    expect(weekly.map((c) => c.time)).toEqual([D(10, 5)]); // a semana de 12/10 ainda não fechou
    expect(weekly[0]).toMatchObject({ open: 10, high: 15, low: 9, close: 14.5, volume: 500 });
    // sexta depois do fechamento, com o candle de sexta: as duas semanas fecharam
    const fri = [...daily, { ...daily[0]!, time: D(10, 15) }, { ...daily[0]!, time: D(10, 16) }];
    expect(
      weeklyFromDaily(closedCandles(fri, '1d', B3, brt(10, 16, 17, 1)), B3, brt(10, 16, 17, 1)),
    ).toHaveLength(2);
  });
});
