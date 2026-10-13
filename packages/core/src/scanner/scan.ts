import type {
  Candle,
  RespectMa,
  ScanAnalysis,
  ScanFundamentals,
  ScanMa,
  ScanSetupHit,
  ScanSetupId,
  ScanState,
  SlopeDir,
  Timeframe,
  TrendValue,
  VolumeQuality,
  WeeklyMa,
} from '@radar/shared';
import { SCAN_PEAK_BARS, SCAN_SPARK_BARS } from '@radar/shared';
import { classifyTrend, respectedMaAt, type MaKey, type TrendLabel } from '../setups/context';
import { SetupEngine, isAgainstHigher } from '../setups/engine';
import { relVolume, slopeDir } from '../setups/pa';
import { DEFAULT_SETUP_PARAMS, type SetupParams } from '../setups/params';
import { SeriesBuffer } from '../setups/series';
import type { Fundamentals, SetupId, SetupState } from '../setups/types';

/** Igualdade de tipos (falha a compilação se as listas de `@radar/shared` saírem do lugar). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;
/** Listas do scanner em `@radar/shared` = tipos do motor (checado pelo compilador). */
export type ScanTypesInSync = [
  Expect<Same<SetupId, ScanSetupId>>,
  Expect<Same<Exclude<SetupState, 'encerrado'>, ScanState>>,
  Expect<Same<TrendLabel, TrendValue>>,
  Expect<Same<MaKey, RespectMa>>,
  Expect<Same<Fundamentals, ScanFundamentals>>,
];

export interface ScanInput {
  /** Candles FECHADOS da escala escolhida, em ordem (o último é o último fechado). */
  candles: readonly Candle[];
  /**
   * Candles semanais FECHADOS (para as inclinações semanais e a queda de 52 semanas). Em '1w' são os
   * próprios `candles`; ausente/null = sem semanal.
   */
  weekly?: readonly Candle[] | null;
  tf: Timeframe;
  /** Fuso da bolsa (escala maior agregada no fuso certo). */
  tz: string;
  tick: number;
  /** Parâmetros dos setups do usuário. */
  params?: SetupParams;
  /** Fundamentos; null = não verificado (nunca conta como forte). */
  fundamentals?: Fundamentals | null;
  /** Qualidade do volume da fonte: 'none' = sem volume (volume relativo null). */
  volume?: VolumeQuality;
}

const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** Queda desde o topo dos últimos `n` candles (fração ≥ 0); null com menos de `n` candles. */
export function drawdownFromPeak(candles: readonly Candle[], n: number): number | null {
  if (candles.length < n) return null;
  let peak = Number.NEGATIVE_INFINITY;
  for (let i = candles.length - n; i < candles.length; i++)
    peak = Math.max(peak, (candles[i] as Candle).high);
  const close = (candles[candles.length - 1] as Candle).close;
  return peak > 0 ? Math.max(0, 1 - close / peak) : null;
}

/** Série com indicadores do core (a mesma que o motor usa) — para o semanal. */
function seriesOf(candles: readonly Candle[], tick: number): SeriesBuffer {
  const s = new SeriesBuffer(tick);
  for (const c of candles) s.push(c);
  return s;
}

/**
 * Varre UM ativo no último candle FECHADO (SPEC §14), com o MESMO motor de setups e as MESMAS funções
 * do painel de contexto (princípio 4). Pura: só lê o que recebe, sem relógio nem rede — dar a ela só
 * candles fechados é responsabilidade de quem chama (`closedCandles`, `weeklyFromDaily`).
 * Devolve null sem candles.
 */
export function scanSymbol(input: ScanInput): ScanAnalysis | null {
  const { candles, tf } = input;
  if (!candles.length) return null;
  const params = input.params ?? DEFAULT_SETUP_PARAMS;
  const pa = params.pa;
  const engine = new SetupEngine({
    params,
    tf,
    tz: input.tz,
    tick: input.tick,
    fundamentals: input.fundamentals ?? null,
  });
  for (const c of candles) engine.push(c);
  const s = engine.series;
  const t = s.length - 1;
  const last = s.c(t);

  // ocorrências ativas, com o "porquê" do último evento de cada uma
  const higher = engine.higherNow();
  const byId = new Map<string, { first: number; reason: string; notes: string[] }>();
  for (const e of engine.events) {
    const cur = byId.get(e.id);
    byId.set(e.id, {
      first: cur?.first ?? e.time,
      reason: e.reason,
      notes: e.notes ?? cur?.notes ?? [],
    });
  }
  const setups: ScanSetupHit[] = engine.open().map((o) => {
    const ev = byId.get(o.id);
    return {
      setup: o.setup,
      side: o.side,
      state: o.state,
      trigger: o.trigger,
      stop: o.stop,
      target: o.target,
      entry: o.entry,
      againstHigher: isAgainstHigher(o.side, higher),
      since: ev?.first ?? last.time,
      reason: ev?.reason ?? '',
      notes: ev?.notes ?? [],
    };
  });

  const slopes: Record<ScanMa, SlopeDir | null> = {
    ema9: slopeDir(s, s.ema9, t, pa),
    ema21: slopeDir(s, s.ema21, t, pa),
    sma50: slopeDir(s, s.sma50, t, pa),
    sma200: slopeDir(s, s.sma200, t, pa),
  };

  const weeklyCandles = tf === '1w' ? candles : (input.weekly ?? null);
  let weekly: ScanAnalysis['weekly'] = null;
  if (weeklyCandles && weeklyCandles.length) {
    const w = tf === '1w' ? s : seriesOf(weeklyCandles, input.tick);
    const wt = w.length - 1;
    const wSlopes: Record<WeeklyMa, SlopeDir | null> = {
      ema21: slopeDir(w, w.ema21, wt, pa),
      sma50: slopeDir(w, w.sma50, wt, pa),
    };
    weekly = { bars: w.length, lastTime: w.c(wt).time, slopes: wSlopes };
  }

  const respected = respectedMaAt(s, engine.pivots, t, pa).best;
  return {
    lastClose: last.close,
    lastTime: last.time,
    bars: s.length,
    setups,
    higher: higher ? { tfLabel: higher.tfLabel, trend: higher.trend } : null,
    trend: classifyTrend(s, engine.pivots, t, pa).value,
    adx: finite(s.v(s.adx, t)),
    respected: respected ? { ...respected } : null,
    slopes,
    weekly,
    drawdown: {
      tf: drawdownFromPeak(candles, SCAN_PEAK_BARS),
      w52: weeklyCandles ? drawdownFromPeak(weeklyCandles, SCAN_PEAK_BARS) : null,
    },
    relVolume: input.volume === 'none' ? null : finite(relVolume(s, t)),
    fundamentals: input.fundamentals ? { ...input.fundamentals } : null,
    spark: candles.slice(-SCAN_SPARK_BARS).map((c) => c.close),
  };
}
