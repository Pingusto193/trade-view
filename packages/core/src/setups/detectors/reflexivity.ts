import { formatNumber, formatPercent, formatSessionDate } from '@radar/shared';
import type { z } from 'zod';
import { Detector, highestHigh } from '../base';
import type { reflexivitySchema } from '../params';
import type { SeriesBuffer } from '../series';
import type { Fundamentals, SetupEvent, StepContext } from '../types';

type PR = z.infer<typeof reflexivitySchema>;
const f = (n: number) => formatNumber(n, 2);

const SURVIVORSHIP =
  'Os exemplos do vídeo (Netflix, Meta, AppLovin, Palantir) foram escolhidos depois do fato. Empresas que caíram e nunca se recuperaram, ou saíram da bolsa, não aparecem: viés de sobrevivência.';

/** Topo de 52 semanas = 52 candles semanais (SPEC §8.8). */
const WEEKS_52 = 52;

/**
 * Reflexividade: distorção entre preço e valor (SPEC §8.8), inspirada em George Soros. Feita para o
 * gráfico SEMANAL: com weeklyOnly (padrão), só roda quando a escala informada é '1w'.
 * - Radar: queda ≥ 50% desde o topo de 52 semanas (ou histórico), MME21 e MMA50 descendo, e (quando
 *   disponíveis) fundamentos fortes. PROIBIDO comprar durante a queda.
 * - Armado: pivô de alta com MME9 e MME21 voltando a subir (em até confirmBars candles). Gatilho na
 *   máxima + 1 tick; stop abaixo do fundo do pivô. Entrada em etapas e sempre dentro do limite de
 *   risco (o plano de trade avisa).
 * - Saída: alvo em R (exit.targetR, padrão 3R) ou condução (fechou abaixo da MME21 → stop na mínima
 *   desse candle − 1 tick).
 * - O aviso de viés de sobrevivência e a situação dos fundamentos vão em TODAS as fases.
 */
export class Reflexivity extends Detector {
  readonly id = 'reflexivity' as const;
  protected readonly paramsForEvents: PR;

  constructor(private readonly p: PR) {
    super();
    this.paramsForEvents = p;
  }

  /**
   * Fundamentos: null = fracos (não é distorção). Senão, as notas e o quanto foi verificado.
   * Campo nulo = não verificado (nunca conta como forte); LPA ≤ 0 no último exercício = fraco.
   */
  private fundamentals(
    fu: Fundamentals | null | undefined,
  ): { notes: string[]; verified: 'todos' | 'parte' | 'nenhum' } | null {
    const eps = fu?.epsGrowth2y ?? null;
    const rev = fu?.revenueNoDecline ?? null;
    if ((eps !== null && eps < this.p.minEpsGrowth) || fu?.epsNegative || rev === false)
      return null;
    const extra = fu?.notes ?? [];
    if (!fu || (eps === null && rev === null))
      return {
        notes: [
          fu
            ? `Fundamentos NÃO verificados (${fu.source} sem dados de LPA e receita).`
            : 'Fundamentos NÃO verificados (sem dados de balanço disponíveis aqui).',
          ...extra,
        ],
        verified: 'nenhum',
      };
    // fonte e exercício usados (ex.: "SEC EDGAR, exercício até 31/12/2025")
    const src = fu.periodEnd
      ? `${fu.source}, exercício até ${formatSessionDate(fu.periodEnd)}`
      : fu.source;
    return {
      notes: [
        eps !== null
          ? `LPA cresceu ${formatPercent(eps, 0)} a.a. em 2 anos (${src}).`
          : 'Crescimento do LPA NÃO verificado.',
        rev === true ? `Receita sem queda (${src}).` : 'Receita NÃO verificada.',
        ...extra,
      ],
      verified: eps !== null && rev !== null ? 'todos' : 'parte',
    };
  }

  step(s: SeriesBuffer, t: number, ctx: StepContext): SetupEvent[] {
    const out: SetupEvent[] = [];
    // "52 semanas", médias e confirmação são do semanal (sem escala informada, roda como antes)
    if (this.p.weeklyOnly && ctx.tf !== undefined && ctx.tf !== '1w') return out;
    const c = s.c(t);

    for (const inst of [...this.active]) {
      if (inst.state === 'acionado') {
        const ex = this.checkExit(inst, s, t);
        if (ex) out.push(ex);
        else if (this.p.exit.mode === 'dynamic' && c.close < s.v(s.ema21, t)) {
          const ns = this.down(c.low, s);
          if (this.trailStop(inst, ns))
            out.push(
              this.ev(
                inst,
                'acionado',
                s,
                t,
                ns,
                `Fechou abaixo da MME21: stop móvel para ${f(ns)}`,
              ),
            );
        }
        continue;
      }
      if (inst.state === 'armado' && t > inst.startIndex) {
        const entered = this.tryEnter(
          inst,
          s,
          t,
          this.p.exit,
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
      // radar → procura confirmação: pivô de alta; depois, até confirmBars candles para MME9 e MME21
      // virarem
      const piv = ctx.pivots.bullishPivot(s, t);
      if (piv) {
        inst.m.pivotAt = t;
        inst.m.f1 = piv.f1.price;
        inst.m.f1Idx = piv.f1.index;
        inst.m.f2 = piv.f2.price;
        inst.m.f2Idx = piv.f2.index;
        inst.m.top = piv.top;
      }
      const pending =
        inst.m.pivotAt !== undefined && t - (inst.m.pivotAt as number) <= this.p.confirmBars;
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
      } else if (t - inst.startIndex > this.p.radarExpiryBars) {
        out.push(
          this.close(
            inst,
            s,
            t,
            'expirou',
            null,
            `${this.p.radarExpiryBars} candles sem confirmação`,
          ),
        );
      }
    }

    if (this.active.length === 0) {
      const from = this.p.peak === '52w' ? t - WEEKS_52 + 1 : 0;
      const peak = highestHigh(s, from, t);
      const dd = 1 - c.close / peak;
      const e21down = s.v(s.ema21, t) < s.v(s.ema21, t - 1);
      const s50down = s.v(s.sma50, t) < s.v(s.sma50, t - 1);
      if (dd >= this.p.minDrawdown && e21down && s50down) {
        const fu = this.fundamentals(ctx.fundamentals);
        if (!fu) return out; // fundamentos fracos: não é distorção
        const inst = this.newInstance('buy', t, s);
        // aviso permanente e fundamentos acompanham todas as fases da ocorrência
        inst.notes.push(SURVIVORSHIP, ...fu.notes);
        this.active.push(inst);
        const verdict =
          fu.verified === 'todos'
            ? ': possível distorção entre preço e valor'
            : fu.verified === 'parte'
              ? ' (fundamentos verificados só em parte)'
              : ' (fundamentos NÃO verificados)';
        out.push(
          this.ev(
            inst,
            'radar',
            s,
            t,
            c.close,
            `Queda de ${formatPercent(dd, 0)} desde o topo, com MME21 e MMA50 descendo${verdict}`,
            {
              notes: [
                ...inst.notes,
                'Proibido comprar durante a queda ("faca caindo"): espere o pivô de alta no semanal.',
              ],
            },
          ),
        );
      }
    }
    return out;
  }
}
