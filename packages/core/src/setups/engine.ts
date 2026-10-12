import type { Candle } from '@radar/shared';
import type { Detector } from './base';
import { Consolidation } from './detectors/consolidation';
import { Elastic } from './detectors/elastic';
import { Pullback } from './detectors/pullback';
import { Reflexivity } from './detectors/reflexivity';
import { Setup91 } from './detectors/s91';
import { Setup92, Setup93 } from './detectors/s92s93';
import { DEFAULT_SETUP_PARAMS, type SetupParams } from './params';
import { PivotTracker } from './pivots';
import { SeriesBuffer } from './series';
import type { Fundamentals, HigherContext, SetupEvent, SetupId, StepContext } from './types';

export interface EngineOptions {
  params?: SetupParams;
  tick?: number;
  /** Quais setups rodar (padrão: todos os ligados nos parâmetros). */
  only?: readonly SetupId[];
  /** Modo estrito: lança erro se algum detector ler candle futuro (usado nos testes). */
  strict?: boolean;
  higher?: (t: number) => HigherContext | null;
  respectedMa?: StepContext['respectedMa'];
  fundamentals?: Fundamentals | null;
}

/**
 * Motor de setups (SPEC §8): processa candle a candle (incremental). O MESMO motor roda no navegador,
 * no servidor de alertas, no scanner e no backtest (princípio 4).
 */
export class SetupEngine {
  readonly series: SeriesBuffer;
  readonly pivots: PivotTracker;
  readonly detectors: Detector[];
  readonly events: SetupEvent[] = [];
  private readonly params: SetupParams;

  constructor(private readonly opts: EngineOptions = {}) {
    this.params = opts.params ?? DEFAULT_SETUP_PARAMS;
    this.series = new SeriesBuffer(opts.tick ?? 0.01);
    this.series.strict = Boolean(opts.strict);
    this.pivots = new PivotTracker(this.params.pa.pivotN);
    const p = this.params;
    const all: [SetupId, boolean, () => Detector][] = [
      ['s91', p.s91.enabled, () => new Setup91(p.s91)],
      ['s92', p.s92.enabled, () => new Setup92(p.s92)],
      ['s93', p.s93.enabled, () => new Setup93(p.s93)],
      ['pullback', p.pullback.enabled, () => new Pullback(p.pullback)],
      ['consolidation', p.consolidation.enabled, () => new Consolidation(p.consolidation)],
      ['elastic', p.elastic.enabled, () => new Elastic(p.elastic)],
      ['reflexivity', p.reflexivity.enabled, () => new Reflexivity(p.reflexivity)],
    ];
    this.detectors = all
      .filter(([id, on]) => on && (!opts.only || opts.only.includes(id)))
      .map(([, , mk]) => mk());
  }

  /** Processa um candle FECHADO. Retorna os eventos gerados nele. */
  push(c: Candle): SetupEvent[] {
    const t = this.series.push(c);
    this.series.cursor = t;
    this.pivots.step(this.series, t);
    const ctx: StepContext = {
      pa: this.params.pa,
      pivots: this.pivots,
      higher: this.opts.higher?.(t) ?? null,
      respectedMa: this.opts.respectedMa ?? null,
      fundamentals: this.opts.fundamentals ?? null,
    };
    const out: SetupEvent[] = [];
    for (const d of this.detectors) out.push(...d.step(this.series, t, ctx));
    this.events.push(...out);
    return out;
  }

  /** Ocorrências ainda abertas (radar, armado ou acionado). */
  open() {
    return this.detectors.flatMap((d) => d.openInstances.map((i) => ({ setup: d.id, ...i })));
  }
}

/** Atalho em lote: roda todos os candles e devolve os eventos. */
export function detectSetups(candles: readonly Candle[], opts: EngineOptions = {}): SetupEvent[] {
  const e = new SetupEngine(opts);
  for (const c of candles) e.push(c);
  return e.events;
}
