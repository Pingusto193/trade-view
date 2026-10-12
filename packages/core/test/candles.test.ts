import type { Candle, Session } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  aggregate,
  heikinAshi,
  marketState,
  sanitizeCandles,
  sessionDate,
  upsertCandle,
  weekStart,
} from '../src';

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const c = (time: number, o: number, h: number, l: number, cl: number, v = 1): Candle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: cl,
  volume: v,
});

describe('agregação', () => {
  it('diário → semanal começa na segunda-feira, mesmo com feriado na segunda', () => {
    // 12/10/2026 é segunda-feira (feriado de N. Sra. Aparecida na B3): semana com terça a sexta.
    const days = [
      c(D(2026, 10, 9), 10, 11, 9, 10.5, 100), // sexta da semana anterior
      c(D(2026, 10, 13), 10.5, 12, 10, 11, 200),
      c(D(2026, 10, 14), 11, 13, 10.8, 12.5, 300),
      c(D(2026, 10, 15), 12.5, 12.6, 9.5, 10, 400),
      c(D(2026, 10, 16), 10, 10.5, 9.9, 10.2, 500),
    ];
    const w = aggregate(days, '1d', '1w', 'America/Sao_Paulo');
    expect(w).toHaveLength(2);
    expect(w[0]).toEqual(c(D(2026, 10, 5), 10, 11, 9, 10.5, 100));
    expect(w[1]).toEqual(c(D(2026, 10, 12), 10.5, 13, 9.5, 10.2, 1400));
  });

  it('diário → mensal usa o dia 1 como data', () => {
    const days = [
      c(D(2026, 9, 30), 1, 2, 0.5, 1.5),
      c(D(2026, 10, 1), 1.5, 3, 1, 2),
      c(D(2026, 10, 2), 2, 2.5, 1.8, 2.2),
    ];
    const m = aggregate(days, '1d', '1M', 'UTC');
    expect(m.map((x) => x.time)).toEqual([D(2026, 9, 1), D(2026, 10, 1)]);
    expect(m[1]).toMatchObject({ open: 1.5, high: 3, low: 1, close: 2.2, volume: 2 });
  });

  it('1m → 5m alinhado ao relógio', () => {
    const t0 = Date.UTC(2026, 9, 12, 13, 0);
    const mins = Array.from({ length: 7 }, (_, i) => c(t0 + i * 60_000, i, i + 1, i - 1, i + 0.5));
    const five = aggregate(mins, '1m', '5m', 'UTC');
    expect(five.map((x) => x.time)).toEqual([t0, t0 + 5 * 60_000]);
    expect(five[0]).toMatchObject({ open: 0, high: 5, low: -1, close: 4.5, volume: 5 });
  });

  it('intradiário → diário usa a data local da bolsa', () => {
    // 23:30 em São Paulo de 12/10 = 02:30 UTC de 13/10
    const t = Date.UTC(2026, 9, 13, 2, 30);
    expect(sessionDate(t, 'America/Sao_Paulo')).toBe(D(2026, 10, 12));
    expect(sessionDate(t, 'UTC')).toBe(D(2026, 10, 13));
  });

  it('não agrega para escala menor', () => {
    expect(() => aggregate([], '1d', '60m', 'UTC')).toThrow();
  });

  it('weekStart de um domingo volta para a segunda anterior', () => {
    expect(weekStart(D(2026, 10, 18))).toBe(D(2026, 10, 12));
  });
});

describe('upsertCandle e sanitize', () => {
  it('substitui o candle em formação e acrescenta o novo', () => {
    const s = [c(1, 1, 1, 1, 1), c(2, 2, 2, 2, 2)];
    upsertCandle(s, c(2, 2, 3, 2, 3));
    expect(s[1]?.close).toBe(3);
    upsertCandle(s, c(3, 3, 3, 3, 3));
    expect(s).toHaveLength(3);
    upsertCandle(s, c(1, 9, 9, 9, 9));
    expect(s[0]?.close).toBe(9);
  });

  it('remove candles inválidos e duplicados', () => {
    const bad = [c(2, 1, 2, 0.5, 1.5), c(1, 1, 0.5, 2, 1), c(2, 1, 3, 0.5, 2), c(3, NaN, 1, 1, 1)];
    expect(sanitizeCandles(bad)).toEqual([c(2, 1, 3, 0.5, 2)]);
  });
});

describe('Heikin-Ashi', () => {
  it('calcula abertura e fechamento médios', () => {
    const ha = heikinAshi([c(1, 10, 12, 9, 11), c(2, 11, 13, 10, 12)]);
    expect(ha[0]).toMatchObject({ open: 10.5, close: 10.5 });
    expect(ha[1]).toMatchObject({ open: 10.5, close: 11.5, high: 13, low: 10 });
  });
});

describe('estado do mercado', () => {
  const b3: Session = {
    timezone: 'America/Sao_Paulo',
    days: [1, 2, 3, 4, 5],
    preOpen: '09:45',
    open: '10:00',
    close: '17:00',
    holidays: ['2026-10-12'],
  };
  it('B3: aberto, pré-abertura, fechado e feriado', () => {
    expect(marketState(b3, Date.UTC(2026, 9, 13, 14, 0))).toBe('open'); // 11:00 SP
    expect(marketState(b3, Date.UTC(2026, 9, 13, 12, 50))).toBe('pre-open'); // 09:50 SP
    expect(marketState(b3, Date.UTC(2026, 9, 13, 21, 0))).toBe('closed'); // 18:00 SP
    expect(marketState(b3, Date.UTC(2026, 9, 12, 14, 0))).toBe('closed'); // feriado
    expect(marketState(b3, Date.UTC(2026, 9, 17, 14, 0))).toBe('closed'); // sábado
  });

  it('cripto: sempre aberto', () => {
    expect(
      marketState({ timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6] }, Date.UTC(2026, 9, 18, 3)),
    ).toBe('open');
  });

  it('forex 24/5: domingo 17h → sexta 17h (Nova York)', () => {
    const fx: Session = {
      timezone: 'America/New_York',
      days: [0, 1, 2, 3, 4, 5],
      weekly: { openDay: 0, openTime: '17:00', closeDay: 5, closeTime: '17:00' },
    };
    expect(marketState(fx, Date.UTC(2026, 9, 14, 12))).toBe('open'); // quarta
    expect(marketState(fx, Date.UTC(2026, 9, 17, 12))).toBe('closed'); // sábado
    expect(marketState(fx, Date.UTC(2026, 9, 18, 20))).toBe('closed'); // domingo 16h em NY (EDT)
    expect(marketState(fx, Date.UTC(2026, 9, 18, 22))).toBe('open'); // domingo 18h em NY
  });
});
