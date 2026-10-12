import { formatNumber } from '@radar/shared';
import type { z } from 'zod';
import { Detector, highestHigh, lowestLow, type Instance } from '../base';
import { relVolume } from '../pa';
import type { consolidationSchema } from '../params';
import type { SeriesBuffer } from '../series';
import type { SetupEvent, StepContext } from '../types';

type PC = z.infer<typeof consolidationSchema>;
const f = (n: number) => formatNumber(n, 2);

/**
 * Rompimento de consolidação apertada — setup 2 do youtuber, o favorito dele (SPEC §8.6). Só compra.
 * - Pré-requisito: tendência de alta antes da caixa (preço acima da MMA50 subindo).
 * - Caixa: 8 a 40 candles, amplitude ≤ 3 × ATR14 medido antes da caixa, contração de volatilidade
 *   (Bollinger 20/2 no menor quintil dos últimos 120 ou ATR5 < ATR20) e volume da caixa abaixo da média.
 * - Gatilho: FECHAMENTO acima do topo da caixa, com volume ≥ 1,5 × média e corpo grande.
 *   Decisão nossa: a entrada é na ABERTURA do candle seguinte (o sinal só existe no fechamento).
 * - Reteste (2ª entrada): volta ao topo rompido, não fecha dentro da caixa e retoma; stop mais curto.
 * - Falso rompimento: voltar a fechar dentro da caixa gera alerta; perder a base é saída (stop).
 */
export class Consolidation extends Detector {
  readonly id = 'consolidation' as const;
  protected readonly paramsForEvents: PC;
  /** Caixa já sinalizada (evita repetir o radar a cada candle). */
  private lastBoxStart = -1;

  constructor(private readonly p: PC) {
    super();
    this.paramsForEvents = p;
  }

  /** Procura a maior caixa válida terminando em t (inclusive). */
  private findBox(
    s: SeriesBuffer,
    t: number,
  ): { start: number; top: number; bottom: number } | null {
    // contração de volatilidade (vale para a caixa toda; calculada uma vez)
    if (!this.contracted(s, t)) return null;
    for (let len = this.p.maxBars; len >= this.p.minBars; len--) {
      const start = t - len + 1;
      if (start < 1) continue;
      const atrBefore = s.v(s.atr14, start - 1);
      if (!(atrBefore > 0)) continue;
      const top = highestHigh(s, start, t);
      const bottom = lowestLow(s, start, t);
      if (top - bottom > this.p.maxRangeAtr * atrBefore) continue;
      // tendência de alta antes da caixa
      const ma = s.v(s.sma50, start - 1);
      if (!(s.c(start - 1).close > ma && ma > s.v(s.sma50, start - 6))) continue;
      // volume da caixa abaixo da média anterior
      let vol = 0;
      for (let k = start; k <= t; k++) vol += s.c(k).volume;
      const avgBefore = s.v(s.volSma21, start - 1);
      if (avgBefore > 0 && vol / len >= avgBefore) continue;
      return { start, top, bottom };
    }
    return null;
  }

  private contracted(s: SeriesBuffer, t: number): boolean {
    const w = s.v(s.bb2Width, t);
    const from = Math.max(0, t - this.p.squeezeLookback + 1);
    const widths: number[] = [];
    for (let k = from; k <= t; k++) {
      const v = s.v(s.bb2Width, k);
      if (Number.isFinite(v)) widths.push(v);
    }
    if (widths.length >= 20 && Number.isFinite(w)) {
      widths.sort((a, b) => a - b);
      const q = widths[Math.floor((widths.length - 1) * this.p.squeezeQuantile)] as number;
      if (w <= q) return true;
    }
    return s.v(s.atr5, t) < s.v(s.atr20, t);
  }

  step(s: SeriesBuffer, t: number, ctx: StepContext): SetupEvent[] {
    const out: SetupEvent[] = [];
    const c = s.c(t);

    for (const inst of [...this.active]) {
      const top = inst.m.top as number;
      const bottom = inst.m.bottom as number;
      if (inst.state === 'acionado') {
        const ex = this.checkExit(inst, s, t);
        if (ex) {
          out.push(ex);
          continue;
        }
        if (
          !inst.m.falseAlerted &&
          t - (inst.m.breakIdx as number) <= ctx.pa.falseBreakBars &&
          c.close < top
        ) {
          inst.m.falseAlerted = 1;
          out.push(
            this.ev(
              inst,
              'acionado',
              s,
              t,
              c.close,
              `⚠ Falso rompimento: voltou a fechar dentro da caixa (abaixo de ${f(top)})`,
            ),
          );
        }
        if (
          this.p.exit.mode === 'dynamic' &&
          c.close < s.v(s.ema9, t) &&
          s.v(s.ema9, t) < s.v(s.ema9, t - 1)
        ) {
          const ns = this.down(c.low, s);
          if (this.trailStop(inst, ns))
            out.push(
              this.ev(
                inst,
                'acionado',
                s,
                t,
                ns,
                `MME9 virou e a mínima foi perdida: stop móvel para ${f(ns)}`,
              ),
            );
        }
        continue;
      }
      if (inst.state === 'radar') {
        if (c.close < bottom) {
          out.push(this.close(inst, s, t, 'invalidado', null, 'Fechou abaixo da base da caixa'));
          continue;
        }
        // caixa cresceu demais?
        const atrBefore = s.v(s.atr14, (inst.m.start as number) - 1);
        if (
          Math.max(top, c.high) - Math.min(bottom, c.low) > this.p.maxRangeAtr * atrBefore &&
          c.close <= top
        ) {
          out.push(this.close(inst, s, t, 'cancelado', null, 'A caixa deixou de ser apertada'));
          continue;
        }
        if (c.close > top) {
          const rv = relVolume(s, t);
          const volOk = !this.p.requireVolume || rv >= this.p.breakoutVolMult;
          const bodyOk =
            Math.abs(c.close - c.open) >= this.p.breakoutBodyMult * s.v(s.bodyAvg20, t);
          inst.m.breakIdx = t;
          if (!volOk || !bodyOk) {
            out.push(
              this.close(
                inst,
                s,
                t,
                'cancelado',
                null,
                `Rompeu sem confirmação (${!volOk ? `volume ${f(rv)}× a média` : 'corpo pequeno'}): rompimento suspeito`,
              ),
            );
            continue;
          }
          const why = `Fechou acima do topo da caixa (${f(top)}) com volume ${f(rv)}× a média`;
          if (this.p.entry === 'breakout') {
            inst.state = 'armado';
            inst.startIndex = t;
            inst.m.mode = 0;
            // entrada na abertura do próximo candle: gatilho "qualquer preço" (stop-limit no próprio fechamento)
            inst.trigger = c.close;
            inst.stop = this.p.stopMode === 'box-low' ? this.down(bottom, s) : this.down(c.low, s);
            out.push(
              this.ev(
                inst,
                'armado',
                s,
                t,
                c.close,
                `${why}. Entrada na abertura do próximo candle (decisão nossa).`,
                { refs: [inst.m.start as number, t] },
              ),
            );
          } else {
            inst.state = 'armado';
            inst.startIndex = t;
            inst.m.mode = 1;
            inst.m.retestWait = 1;
            inst.trigger = null;
            inst.stop = null;
            out.push(
              this.ev(inst, 'armado', s, t, null, `${why}. Aguardando o reteste do topo rompido.`, {
                refs: [inst.m.start as number, t],
              }),
            );
          }
        }
        continue;
      }
      // armado
      if (inst.m.mode === 0 && t > inst.startIndex) {
        // execução na abertura deste candle
        inst.state = 'acionado';
        inst.entry = c.open;
        inst.entryIndex = t;
        inst.initialStop = inst.stop;
        const risk = Math.abs(c.open - (inst.stop as number));
        inst.target =
          this.p.exit.mode === 'fixed' && risk > 0 ? c.open + this.p.exit.targetR * risk : null;
        out.push(
          this.ev(
            inst,
            'acionado',
            s,
            t,
            c.open,
            'Entrada na abertura após o fechamento de rompimento',
          ),
        );
        const ex = this.checkExitEntryBar(inst, s, t);
        if (ex) out.push(ex);
        continue;
      }
      if (inst.m.mode === 1) {
        if (c.close < top) {
          out.push(
            this.close(
              inst,
              s,
              t,
              'invalidado',
              null,
              '⚠ Falso rompimento: voltou a fechar dentro da caixa',
            ),
          );
          continue;
        }
        if (inst.m.retestWait && c.low <= top + 0.25 * s.v(s.atr14, t)) {
          inst.m.retestWait = 0;
          inst.trigger = this.up(c.high, s);
          inst.stop = this.down(Math.min(c.low, top), s);
          out.push(
            this.ev(
              inst,
              'armado',
              s,
              t,
              inst.trigger,
              `Reteste do topo rompido sem fechar dentro da caixa: compra se romper ${f(inst.trigger)} (stop mais curto)`,
            ),
          );
          continue;
        }
        if (!inst.m.retestWait && t > inst.startIndex) {
          const entered = this.tryEnter(inst, s, t, this.p.exit, 'Retomou a alta após o reteste');
          if (entered.length) {
            out.push(...entered);
            continue;
          }
          inst.trigger = this.up(c.high, s);
          inst.stop = this.down(Math.min(lowestLow(s, inst.startIndex, t), top), s);
        }
        if (t - (inst.startIndex as number) > 10)
          out.push(this.close(inst, s, t, 'expirou', null, 'Sem reteste/retomada em 10 candles'));
      }
    }

    // novo radar: caixa terminando no candle anterior (o candle atual ainda pode romper)
    if (this.active.length === 0 && t >= 2) {
      const box = this.findBox(s, t - 1);
      if (box && box.start !== this.lastBoxStart && c.close <= box.top && c.close >= box.bottom) {
        this.lastBoxStart = box.start;
        const inst: Instance = this.newInstance('buy', t, s);
        inst.m.top = box.top;
        inst.m.bottom = box.bottom;
        inst.m.start = box.start;
        this.active.push(inst);
        out.push(
          this.ev(
            inst,
            'radar',
            s,
            t,
            null,
            `Consolidação apertada de ${t - box.start} candles entre ${f(box.bottom)} e ${f(box.top)}, com volatilidade e volume contraídos`,
            {
              refs: [box.start, t - 1],
            },
          ),
        );
      }
    }
    return out;
  }

  private checkExitEntryBar(inst: Instance, s: SeriesBuffer, t: number): SetupEvent | null {
    const c = s.c(t);
    if (inst.stop !== null && c.low <= inst.stop) {
      return this.close(
        inst,
        s,
        t,
        'stop',
        Math.min(inst.stop, c.open),
        'Stop atingido no mesmo candle da entrada',
      );
    }
    return null;
  }
}
