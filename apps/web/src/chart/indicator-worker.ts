/// <reference lib="webworker" />
import {
  IndicatorEngine,
  SetupEngine,
  computeContext,
  marketReading,
  predictReport,
  sessionDate,
  setupParamsSchema,
  type ContextReport,
  type MarketReading,
  type MoneyMeta,
  type PredictionReport,
  type IndicatorOutput,
  type IndicatorPreset,
  type SetupEvent,
  type SetupParams,
} from '@radar/core';
import type { Candle, Timeframe } from '@radar/shared';
import { TIMEFRAME_LABEL } from '@radar/shared';

/**
 * Web Worker de análise (SPEC §5: cálculos pesados fora da thread principal). Usa exatamente o mesmo
 * código do servidor e do backtest (princípio 4): indicadores, motor de setups e contexto.
 * Setups e contexto só usam candles FECHADOS (sem look-ahead).
 */
export type WorkerIn =
  | {
      type: 'reset';
      key: string;
      tf: Timeframe;
      tz: string;
      tick: number;
      preset: IndicatorPreset;
      candles: Candle[];
      lastOpen: boolean;
      setupParams?: unknown;
      /** Dados do ativo para o resultado em dinheiro da previsão. */
      money?: MoneyMeta;
    }
  | { type: 'update'; key: string; candle: Candle; closed: boolean }
  /** Liga/desliga a previsão (SPEC §23.2): só calcula com o painel aberto (custa ~0,4 s/5.000 candles). */
  | { type: 'predict'; key: string; on: boolean }
  | { type: 'dispose'; key: string };

export interface TailValue {
  id: string;
  line: string;
  value: number;
  color?: string;
}

export interface OpenSetup {
  setup: SetupEvent['setup'];
  id: string;
  side: SetupEvent['side'];
  state: 'radar' | 'armado' | 'acionado';
  trigger: number | null;
  stop: number | null;
  target: number | null;
  entry: number | null;
}

export interface AnalysisPayload {
  events: SetupEvent[];
  open: OpenSetup[];
  context: ContextReport | null;
  /** Leitura simples "para onde o preço tende a ir" (ADR-0029). */
  reading: MarketReading | null;
  higherLabel: string | null;
}

export type WorkerOut =
  | { type: 'full'; key: string; outputs: IndicatorOutput[] }
  | { type: 'delta'; key: string; mode: 'append' | 'replace'; time: number; tail: TailValue[] }
  | ({ type: 'analysis'; key: string; reset: boolean } & AnalysisPayload)
  | { type: 'prediction'; key: string; report: PredictionReport | null };

interface ChartState {
  ind: IndicatorEngine;
  setups: SetupEngine;
  closed: Candle[];
  tf: Timeframe;
  tz: string;
  tick: number;
  params: SetupParams;
  predict: boolean;
  money?: MoneyMeta;
  /** Último cálculo da previsão (no intradiário, no máximo um a cada PREDICT_EVERY_MS). */
  predictedAt: number;
}

/** A previsão custa ~1 s com 5.000 candles: em candles de 1 min, recalcula no máximo a cada 20 s. */
const PREDICT_EVERY_MS = 20_000;

const charts = new Map<string, ChartState>();

function post(msg: WorkerOut) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

/** O motor acompanha a escala maior sozinho, candle a candle (agrega `tf` no período maior). */
function buildSetups(
  st: Omit<ChartState, 'setups' | 'ind' | 'predict' | 'predictedAt'>,
): SetupEngine {
  const engine = new SetupEngine({ params: st.params, tick: st.tick, tf: st.tf, tz: st.tz });
  for (const c of st.closed) engine.push(c);
  return engine;
}

/**
 * Camada 1 da previsão com os parâmetros PADRÃO dos setups — os mesmos do placar do servidor, para a
 * probabilidade da tela ser a que o placar grava (ADR-0033).
 */
function prediction(st: ChartState, key: string, force = false) {
  const now = Date.now();
  if (!force && now - st.predictedAt < PREDICT_EVERY_MS) return;
  st.predictedAt = now;
  post({
    type: 'prediction',
    key,
    report: predictReport(st.closed, {
      tf: st.tf,
      tz: st.tz,
      tick: st.tick,
      ...(st.money ? { meta: st.money } : {}),
    }),
  });
}

function analysis(st: ChartState, events: SetupEvent[], reset: boolean, key: string) {
  // o painel usa a MESMA escala maior que o motor usou no último candle fechado
  const h = st.setups.higherNow();
  const higherTf = st.setups.higherTf;
  const context = computeContext(st.closed, {
    pa: st.params.pa,
    higherTrend: h ? h.trend : null,
    ...(higherTf ? { higherLabel: TIMEFRAME_LABEL[higherTf] } : {}),
  });
  const reading = marketReading(st.closed, {
    pa: st.params.pa,
    higherTrend: h ? h.trend : null,
    higherLabel: higherTf ? TIMEFRAME_LABEL[higherTf] : null,
  });
  const open: OpenSetup[] = st.setups.open().map((o) => ({
    setup: o.setup,
    id: o.id,
    side: o.side,
    state: o.state,
    trigger: o.trigger,
    stop: o.stop,
    target: o.target,
    entry: o.entry,
  }));
  post({
    type: 'analysis',
    key,
    reset,
    events,
    open,
    context,
    reading,
    higherLabel: higherTf ? TIMEFRAME_LABEL[higherTf] : null,
  });
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data;
  if (m.type === 'dispose') {
    charts.delete(m.key);
    return;
  }
  if (m.type === 'predict') {
    const st = charts.get(m.key);
    if (!st) return;
    st.predict = m.on;
    if (m.on) prediction(st, m.key, true);
    return;
  }
  if (m.type === 'reset') {
    const parsed = setupParamsSchema.safeParse(m.setupParams ?? {});
    const params = parsed.success ? parsed.data : setupParamsSchema.parse({});
    const ind = new IndicatorEngine(m.preset, m.tf, (t) => sessionDate(t, m.tz));
    post({ type: 'full', key: m.key, outputs: ind.reset(m.candles, m.lastOpen) });
    const closed = m.lastOpen ? m.candles.slice(0, -1) : [...m.candles];
    const base = { closed, tf: m.tf, tz: m.tz, tick: m.tick, params };
    const st: ChartState = {
      ...base,
      ind,
      setups: buildSetups(base),
      predict: charts.get(m.key)?.predict ?? false,
      ...(m.money ? { money: m.money } : {}),
      predictedAt: 0,
    };
    charts.set(m.key, st);
    analysis(st, st.setups.events, true, m.key);
    if (st.predict) prediction(st, m.key, true);
    return;
  }
  const st = charts.get(m.key);
  if (!st) return;
  const mode = st.ind.update(m.candle, m.closed);
  if (mode === 'reset') {
    post({ type: 'full', key: m.key, outputs: st.ind.outputs });
  } else {
    const tail: TailValue[] = [];
    for (const o of st.ind.outputs) {
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
  }
  if (!m.closed) return;
  const last = st.closed[st.closed.length - 1];
  if (last && m.candle.time <= last.time) {
    // correção de candle já fechado: refaz a análise inteira
    const idx = st.closed.findIndex((c) => c.time === m.candle.time);
    if (idx >= 0) st.closed[idx] = m.candle;
    st.setups = buildSetups(st);
    analysis(st, st.setups.events, true, m.key);
    if (st.predict) prediction(st, m.key, true);
    return;
  }
  st.closed.push(m.candle);
  const evs = st.setups.push(m.candle);
  analysis(st, evs, false, m.key);
  if (st.predict) prediction(st, m.key);
};
