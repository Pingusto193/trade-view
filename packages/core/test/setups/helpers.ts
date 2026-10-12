import type { Candle } from '@radar/shared';
import {
  DEFAULT_SETUP_PARAMS,
  detectSetups,
  setupParamsSchema,
  type SetupEvent,
  type SetupId,
  type SetupParams,
} from '../../src';

export const DAY = 86_400_000;
export const T0 = Date.UTC(2020, 0, 1);

/** Construtor de séries feitas à mão. */
export class Bars {
  readonly list: Candle[] = [];

  get last(): Candle {
    return this.list[this.list.length - 1] as Candle;
  }

  get n(): number {
    return this.list.length;
  }

  /** Candle explícito. */
  add(o: number, h: number, l: number, c: number, v = 1000): this {
    this.list.push({
      time: T0 + this.list.length * DAY,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v,
    });
    return this;
  }

  /** Candle "normal" em torno de um fechamento: abre no fechamento anterior. */
  to(close: number, opts: { range?: number; v?: number; open?: number } = {}): this {
    const o = opts.open ?? (this.list.length ? this.last.close : close);
    const r = opts.range ?? 1;
    const hi = Math.max(o, close) + r / 2;
    const lo = Math.min(o, close) - r / 2;
    return this.add(o, hi, lo, close, opts.v ?? 1000);
  }

  /** n candles subindo/descendo `step` por candle. */
  trend(n: number, step: number, opts: { range?: number; v?: number } = {}): this {
    for (let i = 0; i < n; i++) this.to((this.list.length ? this.last.close : 100) + step, opts);
    return this;
  }
}

export function params(patch: (p: SetupParams) => void = () => undefined): SetupParams {
  const p = structuredClone(DEFAULT_SETUP_PARAMS);
  patch(p);
  return setupParamsSchema.parse(p);
}

export function run(
  b: Bars,
  only: SetupId[],
  p: SetupParams = DEFAULT_SETUP_PARAMS,
  tick = 0.01,
): SetupEvent[] {
  return detectSetups(b.list, { only, params: p, tick, strict: true });
}

export const states = (evs: SetupEvent[]) =>
  evs.map((e) => `${e.index}:${e.state}${e.exit ? `/${e.exit}` : ''}`);
