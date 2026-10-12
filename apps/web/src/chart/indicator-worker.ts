/// <reference lib="webworker" />
import {
  IndicatorEngine,
  sessionDate,
  type IndicatorOutput,
  type IndicatorPreset,
} from '@radar/core';
import type { Candle, Timeframe } from '@radar/shared';

/**
 * Web Worker de indicadores (SPEC §5: cálculos pesados fora da thread principal).
 * Usa o mesmo IndicatorEngine do servidor e do backtest (princípio 4).
 */
export type WorkerIn =
  | {
      type: 'reset';
      key: string;
      tf: Timeframe;
      tz: string;
      preset: IndicatorPreset;
      candles: Candle[];
      lastOpen: boolean;
    }
  | { type: 'update'; key: string; candle: Candle; closed: boolean }
  | { type: 'dispose'; key: string };

export interface TailValue {
  id: string;
  line: string;
  value: number;
  color?: string;
}

export type WorkerOut =
  | { type: 'full'; key: string; outputs: IndicatorOutput[] }
  | { type: 'delta'; key: string; mode: 'append' | 'replace'; time: number; tail: TailValue[] };

const engines = new Map<string, IndicatorEngine>();

function post(msg: WorkerOut) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data;
  if (m.type === 'dispose') {
    engines.delete(m.key);
    return;
  }
  if (m.type === 'reset') {
    const engine = new IndicatorEngine(m.preset, m.tf, (t) => sessionDate(t, m.tz));
    engines.set(m.key, engine);
    post({ type: 'full', key: m.key, outputs: engine.reset(m.candles, m.lastOpen) });
    return;
  }
  const engine = engines.get(m.key);
  if (!engine) return;
  const mode = engine.update(m.candle, m.closed);
  if (mode === 'reset') {
    post({ type: 'full', key: m.key, outputs: engine.outputs });
    return;
  }
  const tail: TailValue[] = [];
  for (const o of engine.outputs) {
    for (const l of o.lines) {
      const color = l.colors?.[l.colors.length - 1];
      tail.push({
        id: o.id,
        line: l.key,
        value: l.values[l.values.length - 1] ?? Number.NaN,
        ...(color ? { color } : {}),
      });
    }
  }
  post({ type: 'delta', key: m.key, mode, time: m.candle.time, tail });
};
