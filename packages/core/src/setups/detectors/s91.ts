import { formatNumber } from '@radar/shared';
import { Detector, highestHigh, lowestLow } from '../base';
import type { Side } from '../fills';
import { slope, turnedDown, turnedUp } from '../pa';
import type { setup91Schema } from '../params';
import type { SeriesBuffer } from '../series';
import type { SetupEvent, StepContext } from '../types';
import type { z } from 'zod';

type P91 = z.infer<typeof setup91Schema>;
const f = (n: number) => formatNumber(n, 2);

/**
 * Setup 9.1 (SPEC §8.2), atribuído a Larry Williams.
 * - Condição: a MME9 vinha caindo e VIRA para cima; o candle que a virou é o candle-sinal.
 * - Gatilho: máxima do candle-sinal + 1 tick.
 * - Decisão nossa: se não romper no candle seguinte e a MME9 seguir subindo, o gatilho passa para a
 *   máxima do novo candle; o stop fica abaixo da menor mínima desde o sinal. Se a MME9 virar para baixo
 *   antes do acionamento, cancela.
 * - Filtro (E1): MMA50 subindo; e não operar em lateral (ADX < mínimo ou MMA50 plana).
 * - Saída fixa (alvo em R) ou dinâmica (quando a MME9 vira para baixo, stop vai para a mínima desse
 *   candle; o Radar mantém o stop de proteção inicial — decisão nossa).
 */
export class Setup91 extends Detector {
  readonly id = 's91' as const;
  protected readonly paramsForEvents: P91;

  constructor(private readonly p: P91) {
    super();
    this.paramsForEvents = p;
  }

  private filtersOk(
    s: SeriesBuffer,
    t: number,
    side: Side,
    ctx: StepContext,
  ): { ok: boolean; why: string } {
    if (!this.p.trendFilter) return { ok: true, why: 'sem filtro de tendência (9.1 puro)' };
    const ma50Up = s.v(s.sma50, t) > s.v(s.sma50, t - 1);
    const ma50Down = s.v(s.sma50, t) < s.v(s.sma50, t - 1);
    if (side === 'buy' && !ma50Up) return { ok: false, why: 'MMA50 não está subindo' };
    if (side === 'sell' && !ma50Down) return { ok: false, why: 'MMA50 não está caindo' };
    const adx = s.v(s.adx, t);
    if (!(adx >= this.p.adxMin))
      return { ok: false, why: `ADX ${f(adx)} abaixo de ${this.p.adxMin} (lateral)` };
    const sl = slope(s, s.sma50, t, ctx.pa);
    if (!(Math.abs(sl) >= ctx.pa.flatSlope)) return { ok: false, why: 'MMA50 plana (lateral)' };
    return { ok: true, why: `MMA50 ${side === 'buy' ? 'subindo' : 'caindo'}, ADX ${f(adx)}` };
  }

  step(s: SeriesBuffer, t: number, ctx: StepContext): SetupEvent[] {
    const out: SetupEvent[] = [];
    const c = s.c(t);

    for (const inst of [...this.active]) {
      const buy = inst.side === 'buy';
      if (inst.state === 'armado' && t > inst.startIndex) {
        const entered = this.tryEnter(
          inst,
          s,
          t,
          this.p.exit,
          `Rompeu o gatilho ${f(inst.trigger ?? 0)}`,
        );
        if (entered.length) {
          out.push(...entered);
          continue;
        }
        if (
          buy
            ? turnedDown(s, s.ema9, t) || s.v(s.ema9, t) < s.v(s.ema9, t - 1)
            : turnedUp(s, s.ema9, t) || s.v(s.ema9, t) > s.v(s.ema9, t - 1)
        ) {
          out.push(
            this.close(
              inst,
              s,
              t,
              'desarme',
              null,
              `A MME9 virou para ${buy ? 'baixo' : 'cima'} antes do acionamento`,
            ),
          );
          continue;
        }
        if (this.p.trailTrigger) {
          inst.trigger = buy ? this.up(c.high, s) : this.down(c.low, s);
          inst.stop = buy
            ? this.down(lowestLow(s, inst.startIndex, t), s)
            : this.up(highestHigh(s, inst.startIndex, t), s);
          out.push(
            this.ev(
              inst,
              'armado',
              s,
              t,
              inst.trigger,
              `Não rompeu; gatilho passa para ${buy ? 'a máxima' : 'a mínima'} do novo candle (decisão nossa)`,
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
          this.p.exit.mode === 'dynamic' &&
          t > (inst.entryIndex ?? t) &&
          (buy ? turnedDown(s, s.ema9, t) : turnedUp(s, s.ema9, t))
        ) {
          const ns = buy ? this.down(c.low, s) : this.up(c.high, s);
          if (this.trailStop(inst, ns)) {
            out.push(
              this.ev(
                inst,
                'acionado',
                s,
                t,
                ns,
                `MME9 virou para ${buy ? 'baixo' : 'cima'}: stop móvel para ${f(ns)}`,
              ),
            );
          }
        }
      }
    }

    // novos sinais
    const sides: Side[] = this.p.allowSell ? ['buy', 'sell'] : ['buy'];
    for (const side of sides) {
      if (this.active.some((x) => x.side === side)) continue;
      const buy = side === 'buy';
      if (!(buy ? turnedUp(s, s.ema9, t) : turnedDown(s, s.ema9, t))) continue;
      const fl = this.filtersOk(s, t, side, ctx);
      if (!fl.ok) continue;
      const inst = this.newInstance(side, t, s);
      inst.state = 'armado';
      inst.trigger = buy ? this.up(c.high, s) : this.down(c.low, s);
      let stop = buy ? this.down(c.low, s) : this.up(c.high, s);
      if (this.p.stopMode === 'prior-swing') {
        const piv = buy ? ctx.pivots.lastLow() : ctx.pivots.lastHigh();
        if (piv)
          stop = buy
            ? Math.min(stop, this.down(piv.price, s))
            : Math.max(stop, this.up(piv.price, s));
      }
      inst.stop = stop;
      if (!buy) inst.notes.push('Venda espelhada — não descrita nos vídeos.');
      this.active.push(inst);
      out.push(
        this.ev(
          inst,
          'armado',
          s,
          t,
          inst.trigger,
          `MME9 virou para ${buy ? 'cima' : 'baixo'} (candle-sinal); ${fl.why}`,
          { refs: [t] },
        ),
      );
    }
    return out;
  }
}
