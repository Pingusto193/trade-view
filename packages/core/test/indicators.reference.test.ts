import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  atr,
  bollinger,
  dmi,
  ema,
  macd,
  rsi,
  sma,
  stochastic,
  stopAtr,
  trueRange,
  vwap,
} from '../src';

/**
 * Compara a implementação TypeScript com a referência independente em pandas
 * (tools/reference/indicators_reference.py). Tolerância relativa de 1e-9.
 */
const dir = fileURLToPath(new URL('./reference/', import.meta.url));
const candles = (JSON.parse(readFileSync(`${dir}candles.json`, 'utf8')) as { candles: Candle[] })
  .candles;
const expected = JSON.parse(readFileSync(`${dir}expected.json`, 'utf8')) as Record<
  string,
  (number | null)[]
>;

const TOL = 1e-9;

function compare(name: string, actual: number[]) {
  const ref = expected[name];
  if (!ref) throw new Error(`referência ausente: ${name}`);
  expect(actual.length).toBe(ref.length);
  for (let i = 0; i < ref.length; i++) {
    const r = ref[i];
    const a = actual[i] as number;
    if (r === null || r === undefined) {
      if (!Number.isNaN(a))
        throw new Error(`${name}[${i}]: esperado NaN (aquecimento), obtido ${a}`);
      continue;
    }
    const err = Math.abs(a - r) / Math.max(1, Math.abs(r));
    if (!(err <= TOL)) throw new Error(`${name}[${i}]: esperado ${r}, obtido ${a} (erro ${err})`);
  }
}

const closes = candles.map((c) => c.close);

describe('indicadores × referência pandas', () => {
  it('MMA 50 e 200', () => {
    compare('sma50', sma(closes, 50));
    compare('sma200', sma(closes, 200));
  });

  it('MME 9 e 21 (semente pela MMA)', () => {
    compare('ema9', ema(closes, 9));
    compare('ema21', ema(closes, 21));
  });

  it('MMA 21 do volume', () => {
    compare(
      'volumeSma21',
      sma(
        candles.map((c) => c.volume),
        21,
      ),
    );
  });

  it('Bollinger 20 / 3 desvios', () => {
    const bb = bollinger(closes, 20, 3);
    compare(
      'bb20_3_upper',
      bb.map((b) => b.upper),
    );
    compare(
      'bb20_3_middle',
      bb.map((b) => b.middle),
    );
    compare(
      'bb20_3_lower',
      bb.map((b) => b.lower),
    );
  });

  it('True Range, ATR 14 (Wilder) e ATR 20 exponencial', () => {
    compare('tr', trueRange(candles));
    compare('atr14', atr(candles, 14));
    compare('atrEma20', atr(candles, 20, 'ema'));
  });

  it('ADX 14 com +DI e −DI', () => {
    const d = dmi(candles, 14);
    compare(
      'plusDI14',
      d.map((x) => x.plusDI),
    );
    compare(
      'minusDI14',
      d.map((x) => x.minusDI),
    );
    compare(
      'adx14',
      d.map((x) => x.adx),
    );
  });

  it('Stop ATR 20 × 3 (média exponencial)', () => {
    const s = stopAtr(candles, 20, 3);
    compare(
      'stopAtr20x3',
      s.map((x) => x.stop),
    );
    expect(s.map((x) => x.direction)).toEqual(expected.stopAtr20x3Dir);
  });

  it('opcionais: MACD, IFR, estocástico e VWAP', () => {
    const m = macd(closes);
    compare(
      'macd',
      m.map((x) => x.macd),
    );
    compare(
      'macdSignal',
      m.map((x) => x.signal),
    );
    compare('rsi14', rsi(closes, 14));
    const st = stochastic(candles);
    compare(
      'stochK',
      st.map((x) => x.k),
    );
    compare(
      'stochD',
      st.map((x) => x.d),
    );
    compare(
      'vwapDaily',
      vwap(candles, (t) => Math.floor(t / 86_400_000)),
    );
  });
});
