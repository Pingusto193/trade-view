import { formatNumber } from '@radar/shared';
import type { z } from 'zod';
import { Detector, highestHigh, lowestLow, type ExitConfig, type Instance } from '../base';
import type { Side } from '../fills';
import { turnedDown, turnedUp } from '../pa';
import type { setup92Schema, setup93Schema } from '../params';
import type { SeriesBuffer } from '../series';
import type { SetupEvent, StepContext } from '../types';

const f = (n: number) => formatNumber(n, 2);

interface Leg {
  /** Índice do candle de referência (maior fechamento da pernada). */
  ref: number;
  /** 9.3: fechamentos abaixo do fechamento de referência (contagem). */
  below: number;
}

/**
 * Setups 9.2 e 9.3 (SPEC §8.3 e §8.4). Mesma estrutura; muda a condição que arma.
 * - Pernada: MME9 apontando para cima. Candle de referência = maior fechamento da pernada (atualiza a
 *   cada novo fechamento maior).
 * - 9.2 arma: um candle FECHA abaixo da MÍNIMA do candle de referência, com a MME9 ainda para cima.
 * - 9.3 arma: DOIS fechamentos abaixo do FECHAMENTO de referência (consecutivos por padrão — lacuna do
 *   vídeo, decisão nossa).
 * - Gatilho: máxima do candle que armou + 1 tick; se não romper, passa para a máxima do próximo candle
 *   da correção, enquanto a MME9 seguir para cima.
 * - Stop: 1 tick abaixo da menor mínima da correção. Desarme: MME9 aponta para baixo na correção.
 */
abstract class Setup9x extends Detector {
  private legs: Record<Side, Leg | null> = { buy: null, sell: null };

  constructor(
    protected readonly exit: ExitConfig,
    protected readonly allowSell: boolean,
  ) {
    super();
  }

  /** Condição que arma (diferente no 9.2 e no 9.3). */
  protected abstract arms(s: SeriesBuffer, t: number, side: Side, leg: Leg): boolean;
  protected abstract armReason(side: Side): string;

  step(s: SeriesBuffer, t: number, _ctx: StepContext): SetupEvent[] {
    void _ctx;
    const out: SetupEvent[] = [];
    const c = s.c(t);
    const emaUp = s.v(s.ema9, t) > s.v(s.ema9, t - 1);
    const emaDown = s.v(s.ema9, t) < s.v(s.ema9, t - 1);

    // ocorrências em andamento
    for (const inst of [...this.active]) {
      const buy = inst.side === 'buy';
      if (inst.state === 'armado') {
        if (t > inst.startIndex) {
          const entered = this.tryEnter(
            inst,
            s,
            t,
            this.exit,
            `Rompeu o gatilho ${f(inst.trigger ?? 0)}`,
          );
          if (entered.length) {
            out.push(...entered);
            this.legs[inst.side] = null; // nova pernada começa depois da entrada
            continue;
          }
        }
        if (buy ? emaDown : emaUp) {
          out.push(
            this.close(
              inst,
              s,
              t,
              'desarme',
              null,
              `A MME9 apontou para ${buy ? 'baixo' : 'cima'} durante a correção`,
            ),
          );
          this.legs[inst.side] = null;
          continue;
        }
        if (t > inst.startIndex) {
          inst.trigger = buy ? this.up(c.high, s) : this.down(c.low, s);
          inst.stop = buy
            ? this.down(lowestLow(s, inst.m.corrStart as number, t), s)
            : this.up(highestHigh(s, inst.m.corrStart as number, t), s);
          out.push(
            this.ev(
              inst,
              'armado',
              s,
              t,
              inst.trigger,
              `Não rompeu; gatilho passa para ${buy ? 'a máxima' : 'a mínima'} do próximo candle da correção`,
            ),
          );
        }
        continue;
      }
      if (inst.state === 'acionado') {
        const ex = this.checkExit(inst, s, t);
        if (ex) {
          out.push(ex);
          continue;
        }
        if (
          this.exit.mode === 'dynamic' &&
          t > (inst.entryIndex ?? t) &&
          (buy ? turnedDown(s, s.ema9, t) : turnedUp(s, s.ema9, t))
        ) {
          const ns = buy ? this.down(c.low, s) : this.up(c.high, s);
          if (this.trailStop(inst, ns))
            out.push(this.ev(inst, 'acionado', s, t, ns, `MME9 virou: stop móvel para ${f(ns)}`));
        }
      }
    }

    // pernadas e novos sinais
    const sides: Side[] = this.allowSell ? ['buy', 'sell'] : ['buy'];
    for (const side of sides) {
      const buy = side === 'buy';
      const dirOk = buy ? emaUp : emaDown;
      if (this.active.some((x) => x.side === side)) continue;
      if (!dirOk) {
        this.legs[side] = null;
        continue;
      }
      let leg = this.legs[side];
      if (!leg) {
        leg = { ref: t, below: 0 };
        this.legs[side] = leg;
        continue;
      }
      const ref = s.c(leg.ref);
      if (buy ? c.close > ref.close : c.close < ref.close) {
        leg.ref = t;
        leg.below = 0;
        continue;
      }
      if (this.arms(s, t, side, leg)) {
        const inst = this.newInstance(side, t, s);
        inst.state = 'armado';
        inst.m.corrStart = leg.ref + 1;
        inst.m.ref = leg.ref;
        inst.trigger = buy ? this.up(c.high, s) : this.down(c.low, s);
        inst.stop = buy
          ? this.down(lowestLow(s, leg.ref + 1, t), s)
          : this.up(highestHigh(s, leg.ref + 1, t), s);
        if (!buy) inst.notes.push('Venda espelhada — não descrita nos vídeos.');
        this.active.push(inst);
        out.push(
          this.ev(inst, 'armado', s, t, inst.trigger, this.armReason(side), { refs: [leg.ref, t] }),
        );
      }
    }
    return out;
  }
}

export class Setup92 extends Setup9x {
  readonly id = 's92' as const;
  protected readonly paramsForEvents: z.infer<typeof setup92Schema>;

  constructor(p: z.infer<typeof setup92Schema>) {
    super(p.exit, p.allowSell);
    this.paramsForEvents = p;
  }

  protected arms(s: SeriesBuffer, t: number, side: Side, leg: Leg): boolean {
    const ref = s.c(leg.ref);
    const c = s.c(t);
    return side === 'buy' ? c.close < ref.low : c.close > ref.high;
  }

  protected armReason(side: Side): string {
    return side === 'buy'
      ? 'Candle fechou abaixo da mínima do candle de referência com a MME9 ainda para cima'
      : 'Candle fechou acima da máxima do candle de referência com a MME9 ainda para baixo';
  }
}

export class Setup93 extends Setup9x {
  readonly id = 's93' as const;
  protected readonly paramsForEvents: z.infer<typeof setup93Schema>;

  constructor(private readonly p: z.infer<typeof setup93Schema>) {
    super(p.exit, p.allowSell);
    this.paramsForEvents = p;
  }

  protected arms(s: SeriesBuffer, t: number, side: Side, leg: Leg): boolean {
    const ref = s.c(leg.ref);
    const c = s.c(t);
    const below = side === 'buy' ? c.close < ref.close : c.close > ref.close;
    if (below) leg.below += 1;
    else if (this.p.consecutive) leg.below = 0;
    return leg.below >= 2;
  }

  protected armReason(side: Side): string {
    const cons = this.p.consecutive ? 'consecutivos ' : '';
    return side === 'buy'
      ? `Dois fechamentos ${cons}abaixo do fechamento de referência com a MME9 para cima`
      : `Dois fechamentos ${cons}acima do fechamento de referência com a MME9 para baixo`;
  }
}

export type { Instance };
