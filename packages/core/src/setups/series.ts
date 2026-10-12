import type { Candle } from '@radar/shared';
import { EmaStream, SmaStream } from '../indicators/averages';
import { AtrStream, BollingerStream, DmiStream } from '../indicators/volatility';

/**
 * Série de candles + indicadores usados pelos detectores, construída candle a candle.
 *
 * Garantia contra look-ahead (SPEC §3.5): os detectores recebem o índice `t` do candle que acabou de
 * fechar e só podem ler índices ≤ t. Em modo estrito (testes), ler o futuro lança erro.
 */
export class SeriesBuffer {
  readonly candles: Candle[] = [];
  readonly ema9: number[] = [];
  readonly ema21: number[] = [];
  readonly sma20: number[] = [];
  readonly sma50: number[] = [];
  readonly sma100: number[] = [];
  readonly sma200: number[] = [];
  readonly atr14: number[] = [];
  readonly atr5: number[] = [];
  readonly atr20: number[] = [];
  readonly adx: number[] = [];
  readonly plusDI: number[] = [];
  readonly minusDI: number[] = [];
  readonly bb3Upper: number[] = [];
  readonly bb3Lower: number[] = [];
  readonly bb2Width: number[] = [];
  readonly volSma21: number[] = [];
  /** Média do corpo (|fechamento − abertura|) dos 20 candles ANTERIORES (não inclui o atual). */
  readonly bodyAvg20: number[] = [];

  private readonly s = {
    ema9: new EmaStream(9),
    ema21: new EmaStream(21),
    sma20: new SmaStream(20),
    sma50: new SmaStream(50),
    sma100: new SmaStream(100),
    sma200: new SmaStream(200),
    atr14: new AtrStream(14),
    atr5: new AtrStream(5),
    atr20: new AtrStream(20),
    dmi: new DmiStream(14),
    bb3: new BollingerStream(20, 3),
    bb2: new BollingerStream(20, 2),
    vol: new SmaStream(21),
    body: new SmaStream(20),
  };
  private prevBodyAvg = Number.NaN;

  /** Limite de leitura (modo estrito). */
  cursor = Number.POSITIVE_INFINITY;
  strict = false;

  constructor(
    /** Tamanho do tick do ativo (para "1 tick acima/abaixo"). */
    readonly tick: number = 0.01,
  ) {}

  get length(): number {
    return this.candles.length;
  }

  push(c: Candle): number {
    const s = this.s;
    this.candles.push(c);
    this.ema9.push(s.ema9.next(c.close));
    this.ema21.push(s.ema21.next(c.close));
    this.sma20.push(s.sma20.next(c.close));
    this.sma50.push(s.sma50.next(c.close));
    this.sma100.push(s.sma100.next(c.close));
    this.sma200.push(s.sma200.next(c.close));
    this.atr14.push(s.atr14.next(c));
    this.atr5.push(s.atr5.next(c));
    this.atr20.push(s.atr20.next(c));
    const d = s.dmi.next(c);
    this.adx.push(d.adx);
    this.plusDI.push(d.plusDI);
    this.minusDI.push(d.minusDI);
    const b3 = s.bb3.next(c.close);
    this.bb3Upper.push(b3.upper);
    this.bb3Lower.push(b3.lower);
    this.bb2Width.push(s.bb2.next(c.close).width);
    this.volSma21.push(s.vol.next(c.volume));
    // corpo médio dos 20 anteriores: guarda o valor ANTES de incluir o candle atual
    this.bodyAvg20.push(this.prevBodyAvg);
    this.prevBodyAvg = s.body.next(Math.abs(c.close - c.open));
    return this.candles.length - 1;
  }

  /** Candle no índice k (verifica look-ahead no modo estrito). */
  c(k: number): Candle {
    if (this.strict && k > this.cursor)
      throw new Error(`look-ahead: leitura do índice ${k} em t=${this.cursor}`);
    const v = this.candles[k];
    if (!v) throw new RangeError(`candle ${k} inexistente`);
    return v;
  }

  /** Valor de uma série de indicador no índice k (NaN se fora do intervalo). */
  v(arr: readonly number[], k: number): number {
    if (this.strict && k > this.cursor)
      throw new Error(`look-ahead: leitura do índice ${k} em t=${this.cursor}`);
    return k >= 0 && k < arr.length ? (arr[k] as number) : Number.NaN;
  }
}
