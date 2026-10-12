import { formatNumber, formatPercent } from '@radar/shared';
import type { z } from 'zod';
import { Detector, highestHigh } from '../base';
import type { reflexivitySchema } from '../params';
import type { SeriesBuffer } from '../series';
import type { SetupEvent, StepContext } from '../types';

type PR = z.infer<typeof reflexivitySchema>;
const f = (n: number) => formatNumber(n, 2);

const SURVIVORSHIP =
  'Os exemplos do vídeo (Netflix, Meta, AppLovin, Palantir) foram escolhidos depois do fato. Empresas que caíram e nunca se recuperaram, ou saíram da bolsa, não aparecem: viés de sobrevivência.';

/**
 * Reflexividade: distorção entre preço e valor (SPEC §8.8), inspirada em George Soros. Feita para o
 * gráfico SEMANAL.
 * - Radar: queda ≥ 50% desde o topo de 52 semanas (ou histórico), MME21 e MMA50 descendo, e (quando
 *   disponíveis) fundamentos fortes. PROIBIDO comprar durante a queda.
 * - Armado: pivô de alta com MME9 e MME21 voltando a subir. Gatilho na máxima + 1 tick; stop abaixo do
 *   fundo do pivô. Entrada em etapas e sempre dentro do limite de risco (o plano de trade avisa).
 */
export class Reflexivity extends Detector {
  readonly id = 'reflexivity' as const;
  protected readonly paramsForEvents: PR;

  constructor(private readonly p: PR) {
    super();
    this.paramsForEvents = p;
  }

  step(s: SeriesBuffer, t: number, ctx: StepContext): SetupEvent[] {
    const out: SetupEvent[] = [];
    const c = s.c(t);

    for (const inst of [...this.active]) {
      if (inst.state === 'acionado') {
        const ex = this.checkExit(inst, s, t);
        if (ex) out.push(ex);
        continue;
      }
      if (inst.state === 'armado' && t > inst.startIndex) {
        const entered = this.tryEnter(
          inst,
          s,
          t,
          { mode: 'fixed', targetR: 3 },
          `Rompeu o gatilho ${f(inst.trigger ?? 0)} — 1ª parte da entrada em etapas`,
        );
        if (entered.length) {
          out.push(...entered);
          continue;
        }
        if (c.close < (inst.stop ?? 0)) {
          out.push(
            this.close(inst, s, t, 'invalidado', null, 'Perdeu o fundo do pivô antes de acionar'),
          );
          continue;
        }
        inst.trigger = this.up(c.high, s);
        continue;
      }
      // radar → procura confirmação: pivô de alta; depois, até 8 candles para MME9 e MME21 virarem
      const piv = ctx.pivots.bullishPivot(s, t);
      if (piv) {
        inst.m.pivotAt = t;
        inst.m.f1 = piv.f1.price;
        inst.m.f1Idx = piv.f1.index;
        inst.m.f2 = piv.f2.price;
        inst.m.f2Idx = piv.f2.index;
        inst.m.top = piv.top;
      }
      const pending = inst.m.pivotAt !== undefined && t - (inst.m.pivotAt as number) <= 8;
      const e9up = s.v(s.ema9, t) > s.v(s.ema9, t - 1);
      const e21up = s.v(s.ema21, t) > s.v(s.ema21, t - 1);
      if (pending && c.close < (inst.m.f2 as number)) {
        delete inst.m.pivotAt; // perdeu o fundo do pivô: volta a esperar
      } else if (pending && e9up && e21up) {
        inst.state = 'armado';
        inst.startIndex = t;
        inst.trigger = this.up(c.high, s);
        inst.stop = this.down(inst.m.f2 as number, s);
        out.push(
          this.ev(
            inst,
            'armado',
            s,
            t,
            inst.trigger,
            `Pivô de alta (fundo ${f(inst.m.f2 as number)} acima de ${f(inst.m.f1 as number)}, fechou acima de ${f(inst.m.top as number)}) com MME9 e MME21 voltando a subir`,
            { refs: [inst.m.f1Idx as number, inst.m.f2Idx as number, t] },
          ),
        );
      } else if (t - inst.startIndex > 104) {
        out.push(this.close(inst, s, t, 'expirou', null, 'Dois anos sem confirmação'));
      }
    }

    if (this.active.length === 0) {
      const lookback = this.p.peak === '52w' ? 52 : t;
      const peak = highestHigh(s, t - lookback + 1, t);
      const dd = 1 - c.close / peak;
      const e21down = s.v(s.ema21, t) < s.v(s.ema21, t - 1);
      const s50down = s.v(s.sma50, t) < s.v(s.sma50, t - 1);
      if (dd >= this.p.minDrawdown && e21down && s50down) {
        const fu = ctx.fundamentals;
        const notes = [
          SURVIVORSHIP,
          'Proibido comprar durante a queda ("faca caindo"): espere o pivô de alta no semanal.',
        ];
        if (!fu || fu.epsGrowth2y === null)
          notes.push('Fundamentos NÃO verificados (fonte de fundamentos ainda não configurada).');
        else if (fu.epsGrowth2y < this.p.minEpsGrowth || fu.revenueNoDecline === false)
          return out; // fundamentos fracos: não é distorção
        else
          notes.push(
            `LPA cresceu ${formatPercent(fu.epsGrowth2y, 0)} a.a. em 2 anos (${fu.source}).`,
          );
        const inst = this.newInstance('buy', t, s);
        this.active.push(inst);
        out.push(
          this.ev(
            inst,
            'radar',
            s,
            t,
            c.close,
            `Queda de ${formatPercent(dd, 0)} desde o topo, com MME21 e MMA50 descendo: possível distorção`,
            { notes },
          ),
        );
      }
    }
    return out;
  }
}
