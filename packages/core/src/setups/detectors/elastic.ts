import { formatNumber } from '@radar/shared';
import type { z } from 'zod';
import { BollingerStream } from '../../indicators/volatility';
import { Detector, highestHigh, lowestLow, type Instance } from '../base';
import type { Side } from '../fills';
import { hammer, shootingStar, strongBear, strongBull } from '../pa';
import type { elasticSchema } from '../params';
import type { SeriesBuffer } from '../series';
import type { SetupEvent, StepContext } from '../types';

type PE = z.infer<typeof elasticSchema>;
const f = (n: number) => formatNumber(n, 2);

/** Fração da posição realizada na parcial em 1R (decisão nossa: metade). */
const PARTIAL_FRACTION = 0.5;

/**
 * "Elástico": reversão à média com Bollinger de 3 desvios (SPEC §8.7).
 * ATENÇÃO: opera CONTRA o movimento e conflita com a regra "nunca opere contra a tendência" dos outros
 * vídeos. Estatísticas separadas.
 * - Radar (compra): um candle FECHA abaixo da banda inferior. Pavio fora não conta. Ainda não é compra.
 * - Gatilho: rompimento da máxima do candle que fechou fora; se não romper, passa para a máxima do
 *   candle seguinte, até acionar, o preço voltar à média sem acionar (cancela) ou expirar (5 candles).
 *   Gatilho na média central ou além dela não tem espaço até o alvo: no candle que fechou fora, não
 *   arma e espera o seguinte; depois dele, cancela.
 * - Stop: além do extremo do candle que fechou fora (stopMode 'outside-bar', padrão da SPEC) ou do
 *   extremo desde ele ('extreme-since', variante). O gatilho não passa para um candle cuja máxima
 *   ficaria no stop ou abaixo dele: mantém o anterior (os fins continuam os três da SPEC).
 * - Alvo: a média central (MMA20), com parcial opcional de 50% em 1R que entra no resultado final.
 *   Saída na média sem lucro nunca é "alvo": abriu além da média na entrada = cancelado (0R); média
 *   que chegou à entrada com a posição aberta = saída dinâmica.
 * - Venda: espelhada, com fechamento acima da banda superior.
 */
export class Elastic extends Detector {
  readonly id = 'elastic' as const;
  protected readonly paramsForEvents: PE;
  private readonly bb: BollingerStream;
  private readonly upper: number[] = [];
  private readonly lower: number[] = [];
  private readonly middle: number[] = [];

  constructor(private readonly p: PE) {
    super();
    this.paramsForEvents = p;
    this.bb = new BollingerStream(p.bbPeriod, p.bbStdDev);
  }

  /** Há espaço entre o preço e a média central (alvo)? Compra: preço abaixo da média. */
  private room(side: Side, price: number, mid: number): boolean {
    return side === 'buy' ? price < mid : price > mid;
  }

  /** Stop conforme stopMode: extremo do candle que fechou fora, ou extremo desde ele até t. */
  private stopAt(inst: Instance, s: SeriesBuffer, t: number): number {
    const from = inst.m.radarIdx as number;
    const to = this.p.stopMode === 'extreme-since' ? t : from;
    return inst.side === 'buy'
      ? this.down(lowestLow(s, from, to), s)
      : this.up(highestHigh(s, from, to), s);
  }

  private confirmedAt(side: Side, s: SeriesBuffer, t: number, ctx: StepContext): boolean {
    if (!this.p.requireConfirmation) return true;
    return side === 'buy'
      ? hammer(s, t, ctx.pa) || strongBull(s, t, ctx.pa)
      : shootingStar(s, t, ctx.pa) || strongBear(s, t, ctx.pa);
  }

  /** Posição aberta: stop, alvo (média central do candle anterior) e parcial em 1R. */
  private manage(inst: Instance, s: SeriesBuffer, t: number): SetupEvent[] {
    const out: SetupEvent[] = [];
    const buy = inst.side === 'buy';
    const c = s.c(t);
    const entry = inst.entry as number;
    // alvo dinâmico: a média central conhecida no fechamento anterior
    inst.target = this.middle[t - 1] ?? inst.target;
    // nível da parcial: só se ainda não foi feita e se vem antes do alvo
    let r1: number | null = null;
    if (this.p.partialAt1R && !inst.m.partial && inst.initialStop !== null) {
      const lvl = buy ? entry + (entry - inst.initialStop) : entry - (inst.initialStop - entry);
      if (inst.target === null || this.room(inst.side, lvl, inst.target)) r1 = lvl;
    }
    const partial = (lvl: number): SetupEvent => {
      inst.m.partial = 1;
      return {
        ...this.ev(inst, 'acionado', s, t, lvl, `Parcial em 1R (${f(lvl)})`),
        partial: PARTIAL_FRACTION,
      };
    };
    const ex = this.checkExit(inst, s, t);
    if (!ex) {
      if (r1 !== null && (buy ? c.high >= r1 : c.low <= r1)) out.push(partial(r1));
      return out;
    }
    // stop e 1R no mesmo candle: stop primeiro (conservador), sem parcial. Alvo além de 1R: o preço
    // passou por 1R antes de chegar ao alvo.
    if (ex.exit === 'alvo' && r1 !== null) out.push(partial(r1));
    if (ex.exit === 'alvo' && ex.price !== null && !this.room(inst.side, entry, ex.price)) {
      ex.exit = 'saida-dinamica';
      ex.reason = `A média central (alvo móvel) chegou ao preço de entrada ou passou dele: saída na média ${ex.price === entry ? 'sem lucro' : 'com prejuízo'}`;
    }
    if (inst.m.partial && ex.resultR !== undefined) {
      ex.resultR = PARTIAL_FRACTION * 1 + (1 - PARTIAL_FRACTION) * ex.resultR;
      ex.reason += ' (resultado inclui a parcial de 50% em 1R)';
    }
    out.push(ex);
    return out;
  }

  step(s: SeriesBuffer, t: number, ctx: StepContext): SetupEvent[] {
    const out: SetupEvent[] = [];
    const c = s.c(t);
    // bandas próprias (período/desvios editáveis); alimentadas uma vez por candle
    if (this.middle.length === t) {
      const b = this.bb.next(c.close);
      this.upper.push(b.upper);
      this.lower.push(b.lower);
      this.middle.push(b.middle);
    }
    const mid = this.middle[t] as number;

    for (const inst of [...this.active]) {
      const buy = inst.side === 'buy';
      if (inst.state === 'acionado') {
        out.push(...this.manage(inst, s, t));
        continue;
      }
      // armado (ou radar aguardando confirmação ou espaço até a média)
      if (t > inst.startIndex && inst.state === 'armado') {
        const target = this.middle[t - 1] ?? null;
        inst.target = target;
        const entered = this.tryEnter(
          inst,
          s,
          t,
          { mode: 'dynamic', targetR: 0 },
          `Rompeu ${buy ? 'a máxima' : 'a mínima'} (${f(inst.trigger ?? 0)})`,
        );
        const acted = entered[0];
        if (acted) {
          acted.target = target;
          inst.target = target;
          const entry = inst.entry as number;
          if (target !== null && !this.room(inst.side, entry, target)) {
            // abriu além da média (gap): a ordem do alvo, na média, executa na mesma abertura,
            // antes de qualquer stop dentro do candle
            out.push(
              acted,
              this.close(
                inst,
                s,
                t,
                'cancelado',
                entry,
                `Abriu além da média central (${f(target)}): sem espaço até o alvo; sai no preço de entrada`,
              ),
            );
          } else out.push(...entered);
          continue;
        }
      }
      if (buy ? c.high >= mid : c.low <= mid) {
        out.push(this.close(inst, s, t, 'cancelado', null, 'O preço voltou à média sem acionar'));
        continue;
      }
      if (t - (inst.m.radarIdx as number) >= this.p.expiryBars) {
        out.push(
          this.close(inst, s, t, 'expirou', null, `Não acionou em ${this.p.expiryBars} candles`),
        );
        continue;
      }
      // o gatilho passa para este candle (com confirmação, se exigida) só se ficar do lado certo do
      // stop; senão (candle inteiro além do extremo do candle que fechou fora) fica o anterior
      let trigger = inst.trigger;
      let stop = inst.stop;
      let rolled = false;
      if (this.confirmedAt(inst.side, s, t, ctx)) {
        const next = buy ? this.up(c.high, s) : this.down(c.low, s);
        const nextStop = this.stopAt(inst, s, t);
        if (buy ? next > nextStop : next < nextStop) {
          trigger = next;
          stop = nextStop;
          rolled = true;
        }
      }
      if (trigger === null || stop === null) continue; // radar ainda sem gatilho
      // o alvo da próxima entrada é a média deste candle: gatilho nela ou além dela não tem espaço
      if (!this.room(inst.side, trigger, mid)) {
        out.push(
          this.close(
            inst,
            s,
            t,
            'cancelado',
            null,
            `Sem espaço até a média central: o gatilho (${f(trigger)}) ficaria na média (${f(mid)}) ou além`,
          ),
        );
        continue;
      }
      if (!rolled) continue;
      const wasRadar = inst.state === 'radar';
      inst.state = 'armado';
      if (wasRadar) inst.startIndex = t;
      inst.trigger = trigger;
      inst.stop = stop;
      out.push(
        this.ev(
          inst,
          'armado',
          s,
          t,
          inst.trigger,
          wasRadar
            ? `${this.p.requireConfirmation ? 'Confirmação: ' : ''}${buy ? 'compra' : 'venda'} se romper ${buy ? 'a máxima' : 'a mínima'} deste candle (${f(inst.trigger)}); alvo na média central`
            : `Não rompeu; gatilho passa para ${buy ? 'a máxima' : 'a mínima'} do candle seguinte`,
        ),
      );
    }

    // novo radar: FECHAMENTO fora da banda
    const sides: Side[] = this.p.allowSell ? ['buy', 'sell'] : ['buy'];
    for (const side of sides) {
      if (this.active.some((x) => x.side === side)) continue;
      const buy = side === 'buy';
      const lo = this.lower[t] as number;
      const hi = this.upper[t] as number;
      if (!Number.isFinite(lo) || !(buy ? c.close < lo : c.close > hi)) continue;
      const inst = this.newInstance(side, t, s);
      inst.m.radarIdx = t;
      this.active.push(inst);
      const trigger = buy ? this.up(c.high, s) : this.down(c.low, s);
      const confirmed = this.confirmedAt(side, s, t, ctx);
      const room = this.room(side, trigger, mid);
      const notes = [
        'Estratégia contra o movimento: conflita com "nunca opere contra a tendência".',
      ];
      if (confirmed && !room)
        notes.push(
          `Sem espaço até a média: o gatilho (${f(trigger)}) já está na média central (${f(mid)}) ou além. Não arma neste candle; o gatilho passa para ${buy ? 'a máxima' : 'a mínima'} do candle seguinte.`,
        );
      out.push(
        this.ev(
          inst,
          'radar',
          s,
          t,
          c.close,
          `Fechou ${buy ? 'abaixo da banda inferior' : 'acima da banda superior'} (${f(buy ? lo : hi)}) de ${this.p.bbStdDev} desvios. Ainda NÃO é ${buy ? 'compra' : 'venda'}.`,
          { refs: [t], notes },
        ),
      );
      if (confirmed && room) {
        inst.state = 'armado';
        inst.trigger = trigger;
        inst.stop = this.stopAt(inst, s, t);
        inst.target = mid;
        out.push(
          this.ev(
            inst,
            'armado',
            s,
            t,
            inst.trigger,
            `${buy ? 'Compra' : 'Venda'} se romper ${buy ? 'a máxima' : 'a mínima'} do candle que fechou fora (${f(inst.trigger)}); alvo na média central`,
          ),
        );
      }
    }
    return out;
  }
}
