import { exitFill, roundTick, stopEntryFill, type Side } from './fills';
import type { SeriesBuffer } from './series';
import type { ExitKind, SetupEvent, SetupId, SetupState, StepContext } from './types';

/** Ocorrência em andamento de um setup. */
export interface Instance {
  id: string;
  side: Side;
  state: Exclude<SetupState, 'encerrado'>;
  startIndex: number;
  trigger: number | null;
  stop: number | null;
  target: number | null;
  entry: number | null;
  entryIndex: number | null;
  initialStop: number | null;
  /** Memória específica do detector. */
  m: Record<string, number>;
  notes: string[];
}

export interface ExitConfig {
  mode: 'fixed' | 'dynamic';
  targetR: number;
}

export abstract class Detector {
  abstract readonly id: SetupId;
  protected active: Instance[] = [];
  /** Parâmetros que vão registrados em cada evento. */
  protected abstract readonly paramsForEvents: unknown;

  abstract step(s: SeriesBuffer, t: number, ctx: StepContext): SetupEvent[];

  get openInstances(): readonly Instance[] {
    return this.active;
  }

  protected newInstance(side: Side, t: number, s: SeriesBuffer): Instance {
    return {
      id: `${this.id}:${side}:${s.c(t).time}`,
      side,
      state: 'radar',
      startIndex: t,
      trigger: null,
      stop: null,
      target: null,
      entry: null,
      entryIndex: null,
      initialStop: null,
      m: {},
      notes: [],
    };
  }

  protected ev(
    inst: Instance,
    state: SetupState,
    s: SeriesBuffer,
    t: number,
    price: number | null,
    reason: string,
    extra: Partial<SetupEvent> = {},
  ): SetupEvent {
    return {
      id: inst.id,
      setup: this.id,
      side: inst.side,
      state,
      index: t,
      time: s.c(t).time,
      price,
      reason,
      ...(inst.trigger !== null ? { trigger: inst.trigger } : {}),
      ...(inst.stop !== null ? { stop: inst.stop } : {}),
      ...(inst.target !== null || inst.state === 'acionado' ? { target: inst.target } : {}),
      ...(inst.entry !== null
        ? { entry: inst.entry, entryIndex: inst.entryIndex ?? undefined }
        : {}),
      ...(inst.notes.length ? { notes: [...inst.notes] } : {}),
      params: this.paramsForEvents,
      ...extra,
    };
  }

  protected close(
    inst: Instance,
    s: SeriesBuffer,
    t: number,
    exit: ExitKind,
    price: number | null,
    reason: string,
  ): SetupEvent {
    this.active = this.active.filter((x) => x !== inst);
    let resultR: number | undefined;
    if (inst.entry !== null && inst.initialStop !== null && price !== null) {
      const risk = Math.abs(inst.entry - inst.initialStop);
      if (risk > 0)
        resultR = (inst.side === 'buy' ? price - inst.entry : inst.entry - price) / risk;
    }
    return this.ev(inst, 'encerrado', s, t, price, reason, {
      exit,
      ...(resultR !== undefined ? { resultR } : {}),
    });
  }

  protected up(price: number, s: SeriesBuffer): number {
    return roundTick(price + s.tick, s.tick);
  }

  protected down(price: number, s: SeriesBuffer): number {
    return roundTick(price - s.tick, s.tick);
  }

  /**
   * Tenta executar a entrada de uma ocorrência armada no candle t (ordem stop no gatilho).
   * Na execução, define alvo (modo fixo) e já confere o stop no próprio candle.
   */
  protected tryEnter(
    inst: Instance,
    s: SeriesBuffer,
    t: number,
    exit: ExitConfig,
    why: string,
  ): SetupEvent[] {
    if (inst.state !== 'armado' || inst.trigger === null || inst.stop === null) return [];
    const fill = stopEntryFill(s.c(t), inst.side, inst.trigger);
    if (fill === null) return [];
    inst.state = 'acionado';
    inst.entry = fill;
    inst.entryIndex = t;
    inst.initialStop = inst.stop;
    const risk = Math.abs(fill - inst.stop);
    inst.target =
      exit.mode === 'fixed' && risk > 0
        ? roundTick(
            inst.side === 'buy' ? fill + exit.targetR * risk : fill - exit.targetR * risk,
            s.tick,
          )
        : null;
    const gap = fill !== inst.trigger;
    const out = [
      this.ev(
        inst,
        'acionado',
        s,
        t,
        fill,
        `${why}${gap ? ' (abriu além do gatilho: executado na abertura)' : ''}`,
      ),
    ];
    const ex = exitFill(s.c(t), inst.side, inst.stop, inst.target, true);
    if (ex)
      out.push(
        this.close(inst, s, t, 'stop', ex.price, 'Stop atingido no mesmo candle da entrada'),
      );
    return out;
  }

  /** Confere stop/alvo de uma ocorrência acionada no candle t (antes de qualquer ajuste do stop). */
  protected checkExit(inst: Instance, s: SeriesBuffer, t: number): SetupEvent | null {
    if (inst.state !== 'acionado' || inst.stop === null || t === inst.entryIndex) return null;
    const ex = exitFill(s.c(t), inst.side, inst.stop, inst.target, false);
    if (!ex) return null;
    const moved = inst.initialStop !== null && inst.stop !== inst.initialStop;
    if (ex.kind === 'alvo')
      return this.close(inst, s, t, 'alvo', ex.price, `Alvo atingido${ex.gap ? ' (gap)' : ''}`);
    return this.close(
      inst,
      s,
      t,
      moved ? 'saida-dinamica' : 'stop',
      ex.price,
      moved
        ? `Stop móvel atingido${ex.gap ? ' (gap: na abertura)' : ''}`
        : `Stop atingido${ex.gap ? ' (gap: na abertura)' : ''}`,
    );
  }

  /** Move o stop só a favor do trade (SPEC §11: "stop só anda a favor"). */
  protected trailStop(inst: Instance, newStop: number): boolean {
    if (inst.stop === null) return false;
    if (inst.side === 'buy' ? newStop > inst.stop : newStop < inst.stop) {
      inst.stop = newStop;
      return true;
    }
    return false;
  }
}

/** Menor mínima (ou maior máxima) entre dois índices, inclusive. */
export function lowestLow(s: SeriesBuffer, from: number, to: number): number {
  let m = Number.POSITIVE_INFINITY;
  for (let k = Math.max(0, from); k <= to; k++) m = Math.min(m, s.c(k).low);
  return m;
}

export function highestHigh(s: SeriesBuffer, from: number, to: number): number {
  let m = Number.NEGATIVE_INFINITY;
  for (let k = Math.max(0, from); k <= to; k++) m = Math.max(m, s.c(k).high);
  return m;
}
