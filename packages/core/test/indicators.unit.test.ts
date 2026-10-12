import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  CHANNEL_PRESET,
  CLEAN_PRESET,
  EmaStream,
  IndicatorEngine,
  computeIndicators,
  ema,
  sma,
  stopAtrMultiplier,
} from '../src';

function candle(time: number, close: number, extra: Partial<Candle> = {}): Candle {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 100, ...extra };
}

describe('médias — casos calculados à mão', () => {
  it('MMA de 3: [1,2,3,4,5] → [NaN, NaN, 2, 3, 4]', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([NaN, NaN, 2, 3, 4]);
  });

  it('MME de 3: semente = 2, depois alfa = 0,5', () => {
    // seed = (1+2+3)/3 = 2; t3: 0.5*4 + 0.5*2 = 3; t4: 0.5*5 + 0.5*3 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([NaN, NaN, 2, 3, 4]);
    expect(ema([2, 4, 6, 10], 3)).toEqual([NaN, NaN, 4, 7]);
  });

  it('NaN na entrada não altera o estado (encadeamento)', () => {
    const s = new EmaStream(2);
    expect(s.next(NaN)).toBeNaN();
    expect(s.next(1)).toBeNaN();
    expect(s.next(3)).toBe(2);
  });

  it('peek não altera o estado', () => {
    const s = new EmaStream(3);
    [1, 2, 3].forEach((x) => s.next(x));
    expect(s.peek(100)).not.toBe(s.peek(4));
    expect(s.next(4)).toBe(3);
  });

  it('período inválido gera erro claro', () => {
    expect(() => sma([1], 0)).toThrow(/período/);
  });
});

describe('preset "Padrão do canal"', () => {
  it('tem os indicadores da SPEC §7 ligados e os opcionais desligados', () => {
    const on = CHANNEL_PRESET.indicators.filter((i) => i.enabled).map((i) => i.id);
    expect(on).toEqual([
      'mme9',
      'mme21',
      'mma50',
      'mma200',
      'volume',
      'adx',
      'atr',
      'stopatr',
      'bb3',
    ]);
    const bb = CHANNEL_PRESET.indicators.find((i) => i.id === 'bb3');
    expect(bb).toMatchObject({ kind: 'bollinger', period: 20, stdDev: 3 });
    const m9 = CHANNEL_PRESET.indicators.find((i) => i.id === 'mme9');
    expect(m9).toMatchObject({
      kind: 'ema',
      period: 9,
      color: '#ffffff',
      dashed: true,
      lineWidth: 3,
    });
  });

  it('Stop ATR usa multiplicador 2 no semanal e 3 no diário', () => {
    const cfg = CHANNEL_PRESET.indicators.find((i) => i.kind === 'stopAtr');
    if (cfg?.kind !== 'stopAtr') throw new Error('stopAtr ausente');
    expect(stopAtrMultiplier(cfg, '1w')).toBe(2);
    expect(stopAtrMultiplier(cfg, '1d')).toBe(3);
  });

  it('preset "Limpo" só mostra volume', () => {
    expect(CLEAN_PRESET.indicators.filter((i) => i.enabled).map((i) => i.kind)).toEqual(['volume']);
  });
});

describe('motor incremental', () => {
  const series = Array.from({ length: 300 }, (_, i) =>
    candle(i * 60_000, 100 + Math.sin(i / 7) * 5 + i * 0.05, { volume: 100 + (i % 13) * 10 }),
  );

  it('incremental (fechado por fechado) = lote', () => {
    const batch = computeIndicators(series, CHANNEL_PRESET, '1d');
    const eng = new IndicatorEngine(CHANNEL_PRESET, '1d');
    eng.reset(series.slice(0, 100));
    for (const c of series.slice(100)) eng.update(c, true);
    expect(eng.outputs).toEqual(batch);
  });

  it('candle em formação é substituído sem contaminar o estado', () => {
    const eng = new IndicatorEngine(CHANNEL_PRESET, '1d');
    eng.reset(series.slice(0, 299));
    const last = series[299] as Candle;
    // vários ticks do candle em formação com preços malucos
    expect(eng.update({ ...last, close: last.close * 1.5, high: last.close * 1.5 }, false)).toBe(
      'append',
    );
    expect(eng.update({ ...last, close: last.close * 0.5, low: last.close * 0.5 }, false)).toBe(
      'replace',
    );
    eng.update(last, true);
    expect(eng.outputs).toEqual(computeIndicators(series, CHANNEL_PRESET, '1d'));
  });

  it('lastOpen calcula o último candle com peek', () => {
    const open = computeIndicators(series, CHANNEL_PRESET, '1d', { lastOpen: true });
    const closed = computeIndicators(series, CHANNEL_PRESET, '1d');
    expect(open).toEqual(closed); // mesmos valores; a diferença é só no estado interno
  });

  it('correção de candle antigo força recálculo', () => {
    const eng = new IndicatorEngine(CHANNEL_PRESET, '1d');
    eng.reset(series);
    const fixed = { ...(series[150] as Candle), close: 999, high: 1000 };
    expect(eng.update(fixed, true)).toBe('reset');
    const expected = series.map((c, i) => (i === 150 ? fixed : c));
    expect(eng.outputs).toEqual(computeIndicators(expected, CHANNEL_PRESET, '1d'));
  });
});

describe('desempenho', () => {
  it('10 mil candles com o preset padrão em menos de 300 ms', () => {
    const big = Array.from({ length: 10_000 }, (_, i) =>
      candle(i * 60_000, 100 + Math.sin(i / 50) * 10),
    );
    const t0 = performance.now();
    computeIndicators(big, CHANNEL_PRESET, '1d');
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300);
  });
});
