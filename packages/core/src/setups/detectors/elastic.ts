import { formatNumber } from '@radar/shared';
import type { z } from 'zod';
import { BollingerStream } from '../../indicators/volatility';
import { Detector, highestHigh, lowestLow } from '../base';
import type { Side } from '../fills';
import { hammer, shootingStar, strongBear, strongBull } from '../pa';
import type { elasticSchema } from '../params';
import type { SeriesBuffer } from '../series';
import type { SetupEvent, StepContext } from '../types';

type PE = z.infer<typeof elasticSchema>;
const f = (n: number) => formatNumber(n, 2);

/**
 * "Elástico": reversão à média com Bollinger de 3 desvios (SPEC §8.7).
 * ATENÇÃO: opera CONTRA o movimento e conflita com a regra "nunca opere contra a tendência" dos outros
 * vídeos. Estatísticas separadas.
 * - Radar (compra): um candle FECHA abaixo da banda inferior. Pavio fora não conta. Ainda não é compra.
 * - Gatilho: rompimento da máxima do candle que fechou fora; se não romper, passa para a máxima do
 *   candle seguinte, até acionar, o preço voltar à média sem acionar (cancela) ou expirar (5 candles).
 * - Stop: além do extremo desde o candle que fechou fora. Alvo: a média central (MMA20).
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
        // alvo dinâmico: a média central conhecida no fechamento anterior
        inst.target = this.middle[t - 1] ?? inst.target;
        const ex = this.checkExit(inst, s, t);
        if (ex) {
          out.push(ex);
          continue;
        }
        if (
          this.p.partialAt1R &&
          !inst.m.partial &&
          inst.entry !== null &&
          inst.initialStop !== null
        ) {
          const r1 = buy
            ? inst.entry + (inst.entry - inst.initialStop)
            : inst.entry - (inst.initialStop - inst.entry);
          if (buy ? c.high >= r1 : c.low <= r1) {
            inst.m.partial = 1;
            out.push(this.ev(inst, 'acionado', s, t, r1, `Parcial em 1R (${f(r1)})`));
          }
        }
        continue;
      }
      // armado (ou radar aguardando confirmação)
      if (t > inst.startIndex && inst.state === 'armado') {
        inst.target = this.middle[t - 1] ?? null;
        const entered = this.tryEnter(
          inst,
          s,
          t,
          { mode: 'dynamic', targetR: 0 },
          `Rompeu ${buy ? 'a máxima' : 'a mínima'} (${f(inst.trigger ?? 0)})`,
        );
        if (entered.length) {
          const acted = entered[0];
          if (acted) acted.target = this.middle[t - 1] ?? null;
          inst.target = this.middle[t - 1] ?? null;
          out.push(...entered);
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
      if (t > inst.startIndex || inst.state === 'radar') {
        const confirmed =
          !this.p.requireConfirmation ||
          (buy
            ? hammer(s, t, ctx.pa) || strongBull(s, t, ctx.pa)
            : shootingStar(s, t, ctx.pa) || strongBear(s, t, ctx.pa));
        if (!confirmed) continue;
        const wasRadar = inst.state === 'radar';
        inst.state = 'armado';
        if (wasRadar) inst.startIndex = t;
        inst.trigger = buy ? this.up(c.high, s) : this.down(c.low, s);
        inst.stop = buy
          ? this.down(lowestLow(s, inst.m.radarIdx as number, t), s)
          : this.up(highestHigh(s, inst.m.radarIdx as number, t), s);
        out.push(
          this.ev(
            inst,
            'armado',
            s,
            t,
            inst.trigger,
            wasRadar
              ? `Confirmação: ${buy ? 'compra' : 'venda'} se romper ${f(inst.trigger)}`
              : `Não rompeu; gatilho passa para ${buy ? 'a máxima' : 'a mínima'} do candle seguinte`,
          ),
        );
      }
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
      out.push(
        this.ev(
          inst,
          'radar',
          s,
          t,
          c.close,
          `Fechou ${buy ? 'abaixo da banda inferior' : 'acima da banda superior'} (${f(buy ? lo : hi)}) de ${this.p.bbStdDev} desvios. Ainda NÃO é ${buy ? 'compra' : 'venda'}.`,
          {
            refs: [t],
            notes: [
              'Estratégia contra o movimento: conflita com "nunca opere contra a tendência".',
            ],
          },
        ),
      );
      const confirmed =
        !this.p.requireConfirmation ||
        (buy
          ? hammer(s, t, ctx.pa) || strongBull(s, t, ctx.pa)
          : shootingStar(s, t, ctx.pa) || strongBear(s, t, ctx.pa));
      if (confirmed) {
        inst.state = 'armado';
        inst.trigger = buy ? this.up(c.high, s) : this.down(c.low, s);
        inst.stop = buy ? this.down(c.low, s) : this.up(c.high, s);
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
