import type { Candle, Timeframe } from '@radar/shared';
import { higherTimeframe } from '@radar/shared';
import type { Detector } from './base';
import { respectedMaAt, type MaKey } from './context';
import { Consolidation } from './detectors/consolidation';
import { Elastic } from './detectors/elastic';
import { Pullback } from './detectors/pullback';
import { Reflexivity } from './detectors/reflexivity';
import { Setup91 } from './detectors/s91';
import { Setup92, Setup93 } from './detectors/s92s93';
import type { Side } from './fills';
import { HigherTrendTracker } from './higher';
import { DEFAULT_SETUP_PARAMS, type SetupParams } from './params';
import { PivotTracker } from './pivots';
import { SeriesBuffer } from './series';
import type { Fundamentals, HigherContext, SetupEvent, SetupId, StepContext } from './types';

export interface EngineOptions {
  params?: SetupParams;
  /**
   * Escala e fuso da série. Com `tf`, o motor acompanha sozinho a escala maior (vento a favor/contra),
   * agregando os próprios candles; também restringe setups a certas escalas.
   */
  tf?: Timeframe;
  tz?: string;
  tick?: number;
  /** Quais setups rodar (padrão: todos os ligados nos parâmetros). */
  only?: readonly SetupId[];
  /** Modo estrito: lança erro se algum detector ler candle futuro (usado nos testes). */
  strict?: boolean;
  /**
   * SÓ PARA TESTES: substitui a escala maior que o motor calcula. Ao vivo, no backtest e nos alertas,
   * deixe vazio e informe `tf`/`tz`.
   */
  higher?: (t: number) => HigherContext | null;
  /**
   * SÓ PARA TESTES: fixa a média respeitada na série inteira. Nunca preencha com o painel de contexto
   * (seria look-ahead): por padrão o motor a calcula em cada candle, com a mesma regra do painel.
   */
  respectedMa?: StepContext['respectedMa'];
  fundamentals?: Fundamentals | null;
}

/** Texto do aviso vermelho (SPEC §9) anotado nos eventos contra a escala maior. */
export function againstHigherNote(h: HigherContext): string {
  return `⚠ Aviso vermelho: contra a escala maior (${h.tfLabel} em ${h.trend})`;
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
  /** Escala maior acompanhada (null sem `tf` ou quando não há escala maior). */
  readonly higherTf: Timeframe | null;
  private readonly params: SetupParams;
  private readonly higherTracker: HigherTrendTracker | null;
  private higherLast: HigherContext | null = null;
  /** Média respeitada: só muda quando um fundo novo se confirma (cache pelo número de fundos). */
  private respected: { lows: number; ma: MaKey | null } = { lows: -1, ma: null };

  constructor(private readonly opts: EngineOptions = {}) {
    this.params = opts.params ?? DEFAULT_SETUP_PARAMS;
    this.series = new SeriesBuffer(opts.tick ?? 0.01);
    this.series.strict = Boolean(opts.strict);
    this.pivots = new PivotTracker(this.params.pa.pivotN);
    this.higherTracker =
      opts.tf && !opts.higher
        ? HigherTrendTracker.for(opts.tf, opts.tz ?? 'UTC', this.params.pa)
        : null;
    this.higherTf = opts.tf ? higherTimeframe(opts.tf) : null;
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
    // a escala maior anda junto, candle a candle (só períodos maiores já fechados)
    const fromTracker = this.higherTracker?.push(c) ?? null;
    const higher = this.opts.higher ? this.opts.higher(t) : fromTracker;
    this.higherLast = higher;
    const ctx: StepContext = {
      pa: this.params.pa,
      ...(this.opts.tf ? { tf: this.opts.tf } : {}),
      pivots: this.pivots,
      higher,
      respectedMa:
        this.opts.respectedMa !== undefined ? this.opts.respectedMa : this.respectedAt(t),
      fundamentals: this.opts.fundamentals ?? null,
    };
    const out: SetupEvent[] = [];
    for (const d of this.detectors) out.push(...d.step(this.series, t, ctx));
    if (higher) for (const e of out) markAgainstHigher(e, higher);
    this.events.push(...out);
    return out;
  }

  /** Escala maior usada no último candle processado (a mesma que o painel de contexto deve mostrar). */
  higherNow(): HigherContext | null {
    return this.higherLast;
  }

  /** Ocorrências ainda abertas (radar, armado ou acionado). */
  open() {
    return this.detectors.flatMap((d) => d.openInstances.map((i) => ({ setup: d.id, ...i })));
  }

  private respectedAt(t: number): MaKey | null {
    const n = this.pivots.lows.length;
    if (n !== this.respected.lows)
      this.respected = {
        lows: n,
        ma: respectedMaAt(this.series, this.pivots, t, this.params.pa).best?.ma ?? null,
      };
    return this.respected.ma;
  }
}

/** Aviso vermelho (SPEC §9): compra com a escala maior em baixa; venda com ela em alta. */
export function isAgainstHigher(side: Side, h: HigherContext | null): boolean {
  if (!h) return false;
  return side === 'buy' ? h.trend === 'baixa' : h.trend === 'alta';
}

function markAgainstHigher(e: SetupEvent, h: HigherContext): void {
  if (e.state === 'encerrado') return;
  if (!isAgainstHigher(e.side, h)) return;
  e.againstHigher = true;
  e.notes = [...(e.notes ?? []), againstHigherNote(h)];
}

/** Atalho em lote: roda todos os candles e devolve os eventos. */
export function detectSetups(candles: readonly Candle[], opts: EngineOptions = {}): SetupEvent[] {
  const e = new SetupEngine(opts);
  for (const c of candles) e.push(c);
  return e.events;
}
