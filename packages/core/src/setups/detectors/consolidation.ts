import { formatNumber } from '@radar/shared';
import type { z } from 'zod';
import { Detector, highestHigh, lowestLow, type Instance } from '../base';
import { roundTick } from '../fills';
import { brokeAbove, brokeBelow, closedInsideBelow, falseBreakoutUp, relVolume } from '../pa';
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
 *   Todo candle que fecha dentro (inclusive o do radar) entra na caixa: topo e base acompanham os
 *   pavios. Se a caixa passar de maxBars candles sem romper, o radar expira.
 * - Gatilho: FECHAMENTO acima do topo da caixa (pavio só conta se pa.breakoutByClose = false), com
 *   volume ≥ 1,5 × média e corpo grande. Sem dado de volume, o filtro não pode ser aplicado.
 *   Decisão nossa: a entrada é na ABERTURA do candle seguinte (o sinal só existe no fechamento).
 * - Reteste (2ª entrada): volta ao topo rompido, não fecha dentro da caixa e retoma; stop mais curto.
 * - Falso rompimento (primitiva da §8.1): voltar a fechar dentro da caixa gera alerta; perder a base é
 *   saída (stop).
 */
export class Consolidation extends Detector {
  readonly id = 'consolidation' as const;
  protected readonly paramsForEvents: PC;
  /** Caixa já sinalizada (evita repetir o radar a cada candle). */
  private lastBoxStart = -1;
  /** Uma nova caixa só pode começar aqui ou depois (não reaproveita uma consolidação que expirou). */
  private minStart = 1;

  constructor(private readonly p: PC) {
    super();
    this.paramsForEvents = p;
  }

  /** Procura a maior caixa válida terminando em t (inclusive), com no máximo `maxLen` candles. */
  private findBox(
    s: SeriesBuffer,
    t: number,
    maxLen: number,
  ): { start: number; top: number; bottom: number } | null {
    // contração de volatilidade (vale para a caixa toda; calculada uma vez)
    if (!this.contracted(s, t)) return null;
    for (let len = maxLen; len >= this.p.minBars; len--) {
      const start = t - len + 1;
      if (start < this.minStart) continue;
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

  /** Caixa com o candle t dentro dela (topo e base acompanham os pavios); null se deixou de ser apertada. */
  private grow(
    s: SeriesBuffer,
    t: number,
    start: number,
    top: number,
    bottom: number,
  ): { top: number; bottom: number } | null {
    const c = s.c(t);
    const nTop = Math.max(top, c.high);
    const nBottom = Math.min(bottom, c.low);
    if (nTop - nBottom > this.p.maxRangeAtr * s.v(s.atr14, start - 1)) return null;
    return { top: nTop, bottom: nBottom };
  }

  /**
   * Alerta (uma vez) de falso rompimento depois da entrada: voltou a fechar dentro da caixa em até
   * pa.falseBreakBars candles (SPEC §8.1). A janela conta a partir da entrada: no rompimento é o candle
   * seguinte ao de rompimento; no reteste, fechar dentro antes da entrada já invalida o setup.
   */
  private falseBreakAlert(
    inst: Instance,
    s: SeriesBuffer,
    t: number,
    ctx: StepContext,
  ): SetupEvent | null {
    const top = inst.m.top as number;
    if (inst.m.falseAlerted || !falseBreakoutUp(s, (inst.entryIndex as number) - 1, t, top, ctx.pa))
      return null;
    inst.m.falseAlerted = 1;
    return this.ev(
      inst,
      'acionado',
      s,
      t,
      s.c(t).close,
      `⚠ Falso rompimento: voltou a fechar dentro da caixa (topo ${f(top)})`,
    );
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
        const fb = this.falseBreakAlert(inst, s, t, ctx);
        if (fb) out.push(fb);
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
        if (brokeBelow(s, t, bottom, ctx.pa)) {
          out.push(
            this.close(
              inst,
              s,
              t,
              'invalidado',
              null,
              ctx.pa.breakoutByClose ? 'Fechou abaixo da base da caixa' : 'Perdeu a base da caixa',
            ),
          );
          continue;
        }
        if (brokeAbove(s, t, top, ctx.pa)) {
          const rv = relVolume(s, t);
          const hasVol = Number.isFinite(rv);
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
                !volOk && !hasVol
                  ? 'Rompeu sem confirmação: sem dado de volume, o filtro de volume não pode ser aplicado'
                  : `Rompeu sem confirmação (${!volOk ? `volume ${f(rv)}× a média` : 'corpo pequeno'}): rompimento suspeito`,
              ),
            );
            continue;
          }
          const how = c.close > top ? 'Fechou acima do topo' : 'O pavio rompeu o topo';
          const why = `${how} da caixa (${f(top)}) ${hasVol ? `com volume ${f(rv)}× a média` : 'sem dado de volume'}`;
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
          continue;
        }
        // fechou dentro: o candle entra na caixa
        const box = this.grow(s, t, inst.m.start as number, top, bottom);
        if (!box) {
          out.push(this.close(inst, s, t, 'cancelado', null, 'A caixa deixou de ser apertada'));
          continue;
        }
        inst.m.top = box.top;
        inst.m.bottom = box.bottom;
        if (t - (inst.m.start as number) + 1 > this.p.maxBars) {
          this.minStart = t + 1;
          out.push(
            this.close(
              inst,
              s,
              t,
              'expirou',
              null,
              `A consolidação passou de ${this.p.maxBars} candles sem romper`,
            ),
          );
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
        // alvo arredondado ao tick, como no reteste e nos outros setups (ADR-0012)
        inst.target =
          this.p.exit.mode === 'fixed' && risk > 0
            ? roundTick(c.open + this.p.exit.targetR * risk, s.tick)
            : null;
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
        if (ex) {
          out.push(ex);
          continue;
        }
        const fb = this.falseBreakAlert(inst, s, t, ctx);
        if (fb) out.push(fb);
        continue;
      }
      if (inst.m.mode === 1) {
        // com o gatilho definido, a ordem stop executa durante o candle, antes de ele fechar
        if (!inst.m.retestWait) {
          const entered = this.tryEnter(inst, s, t, this.p.exit, 'Retomou a alta após o reteste');
          if (entered.length) {
            out.push(...entered);
            const fb = this.active.includes(inst) ? this.falseBreakAlert(inst, s, t, ctx) : null;
            if (fb) out.push(fb);
            continue;
          }
        }
        if (closedInsideBelow(s, t, top)) {
          out.push(
            this.close(
              inst,
              s,
              t,
              'invalidado',
              null,
              falseBreakoutUp(s, inst.m.breakIdx as number, t, top, ctx.pa)
                ? '⚠ Falso rompimento: voltou a fechar dentro da caixa'
                : 'Voltou a fechar dentro da caixa antes de retomar: o reteste falhou',
            ),
          );
          continue;
        }
        if (inst.m.retestWait && c.low <= top + this.p.retestAtr * s.v(s.atr14, t)) {
          inst.m.retestWait = 0;
          inst.m.retestIdx = t;
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
        if (!inst.m.retestWait) {
          // o stop segue abaixo do reteste (nunca volta para a mínima do candle de rompimento)
          inst.trigger = this.up(c.high, s);
          inst.stop = this.down(Math.min(lowestLow(s, inst.m.retestIdx as number, t), top), s);
        }
        if (t - inst.startIndex > this.p.retestExpiryBars)
          out.push(
            this.close(
              inst,
              s,
              t,
              'expirou',
              null,
              `Sem reteste/retomada em ${this.p.retestExpiryBars} candles`,
            ),
          );
      }
    }

    // novo radar: caixa terminando no candle anterior (o candle atual ainda pode romper). Se o candle
    // atual fechar dentro, ele entra na caixa — por isso ela pode ter no máximo maxBars − 1 antes dele.
    if (this.active.length === 0 && t >= 2) {
      const found = this.findBox(s, t - 1, this.p.maxBars - 1);
      const box =
        found &&
        found.start !== this.lastBoxStart &&
        !brokeAbove(s, t, found.top, ctx.pa) &&
        !brokeBelow(s, t, found.bottom, ctx.pa)
          ? this.grow(s, t, found.start, found.top, found.bottom)
          : null;
      if (found && box) {
        this.lastBoxStart = found.start;
        const inst: Instance = this.newInstance('buy', t, s);
        inst.m.top = box.top;
        inst.m.bottom = box.bottom;
        inst.m.start = found.start;
        this.active.push(inst);
        const vol =
          s.v(s.volSma21, found.start - 1) > 0
            ? 'com volatilidade e volume contraídos'
            : 'com volatilidade contraída (volume indisponível: não foi verificado)';
        out.push(
          this.ev(
            inst,
            'radar',
            s,
            t,
            null,
            `Consolidação apertada de ${t - found.start + 1} candles entre ${f(box.bottom)} e ${f(box.top)}, ${vol}`,
            {
              refs: [found.start, t],
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
