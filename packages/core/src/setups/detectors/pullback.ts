import { formatNumber } from '@radar/shared';
import type { z } from 'zod';
import { Detector, lowestLow } from '../base';
import { hammer, insideBar, relVolume, slope, strongBear, strongBull, volumeDrying } from '../pa';
import type { pullbackSchema } from '../params';
import type { SeriesBuffer } from '../series';
import type { SetupEvent, StepContext } from '../types';

type PP = z.infer<typeof pullbackSchema>;
const f = (n: number) => formatNumber(n, 2);
const MA_LABEL = {
  ema9: 'MME9',
  ema21: 'MME21',
  sma50: 'MMA50',
  sma100: 'MMA100',
  sma200: 'MMA200',
} as const;
type MaKey = keyof typeof MA_LABEL;

/**
 * Recuo à média — setup 1 do youtuber (SPEC §8.5). Só compra.
 * - Pré-requisito: tendência de alta (estrutura ascendente, MME21 e MMA50 subindo, escala maior não
 *   contra). Sem isso não existe setup.
 * - Radar: o preço recuou até a região da média (mínima a até k × ATR da média). TOCAR A MÉDIA NÃO É
 *   SINAL.
 * - Armado: depois do fechamento de um candle na região, o gatilho é a máxima desse candle + 1 tick
 *   (rompimento da máxima do candle anterior); candle de força, martelo ou inside bar pontuam mais.
 * - Pontuação de recuo saudável: volume secando, candles menores que os do impulso, fundo anterior
 *   preservado. Alertas: queda com volume alto, barra de força de baixa.
 * - Invalidação: perde o fundo do recuo; a média vira para baixo e é perdida; escala maior contra.
 *   As que dependem do fechamento só valem se a ordem stop não executou no candle (depois da
 *   execução valem stop e alvo).
 * - Expiração (decisão nossa): armado sem acionar em `expiryBars` candles; radar sem armar em
 *   `radarExpiryBars` candles depois de aparecer (senão fica preso a um topo antigo e, como só há
 *   uma ocorrência por vez, bloqueia os recuos seguintes).
 */
export class Pullback extends Detector {
  readonly id = 'pullback' as const;
  protected readonly paramsForEvents: PP;

  constructor(private readonly p: PP) {
    super();
    this.paramsForEvents = p;
  }

  private maKey(ctx: StepContext): MaKey {
    if (this.p.ma !== 'auto') return this.p.ma;
    const r = ctx.respectedMa;
    return r ?? 'ema21';
  }

  private arr(s: SeriesBuffer, k: MaKey): readonly number[] {
    return s[k];
  }

  private uptrend(s: SeriesBuffer, t: number, ctx: StepContext): { ok: boolean; why: string } {
    if (ctx.pivots.trend() !== 'alta')
      return { ok: false, why: 'estrutura de topos e fundos não é de alta' };
    if (!(s.v(s.sma50, t) > s.v(s.sma50, t - 1)))
      return { ok: false, why: 'MMA50 não está subindo' };
    // inclinação da MME21 com o passo configurável (pa.slopeLookback, SPEC §8.1)
    if (!(slope(s, s.ema21, t, ctx.pa) > 0)) return { ok: false, why: 'MME21 não está subindo' };
    if (ctx.higher && ctx.higher.trend === 'baixa')
      return { ok: false, why: `escala maior (${ctx.higher.tfLabel}) em baixa` };
    return { ok: true, why: 'estrutura de alta, MME21 e MMA50 subindo' };
  }

  step(s: SeriesBuffer, t: number, ctx: StepContext): SetupEvent[] {
    const out: SetupEvent[] = [];
    const c = s.c(t);
    const atr = s.v(s.atr14, t);

    // novo radar (antes do laço, para o próprio candle do radar poder armar se fechar na região)
    if (this.active.length === 0) {
      const up = this.uptrend(s, t, ctx);
      if (up.ok) {
        const key = this.maKey(ctx);
        const ma = this.arr(s, key);
        const swing = ctx.pivots.lastHigh();
        const prior = ctx.pivots.lastLow();
        const near = c.low <= s.v(ma, t) + this.p.nearAtr * atr;
        if (swing && prior && near && c.close < swing.price && prior.index < swing.index) {
          const inst = this.newInstance('buy', t, s);
          inst.m.ma = (Object.keys(MA_LABEL) as MaKey[]).indexOf(key);
          inst.m.swingIdx = swing.index;
          inst.m.impulseStart = prior.index;
          inst.m.priorLow = prior.price;
          this.active.push(inst);
          const sc = this.score(s, t, swing.index, prior.index, prior.price, ctx);
          out.push(
            this.ev(
              inst,
              'radar',
              s,
              t,
              null,
              `Recuo chegou à região da ${MA_LABEL[key]} (${up.why}). Tocar a média NÃO é sinal: espere o gatilho.`,
              {
                score: sc.points,
                notes: [...sc.notes, ...sc.alerts.map((a) => `⚠ ${a}`)],
                refs: [prior.index, swing.index, t],
              },
            ),
          );
        }
      }
    }

    for (const inst of [...this.active]) {
      const key = (Object.keys(MA_LABEL) as MaKey[])[inst.m.ma as number] ?? 'ema21';
      const ma = this.arr(s, key);
      if (inst.state === 'acionado') {
        const ex = this.checkExit(inst, s, t);
        if (ex) out.push(ex);
        else if (
          this.p.exit.mode === 'dynamic' &&
          t > (inst.entryIndex ?? t) &&
          c.close < s.v(s.ema9, t)
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
                `Fechou abaixo da MME9: stop móvel para ${f(ns)}`,
              ),
            );
        }
        continue;
      }
      // radar ou armado: a escala maior já é conhecida na abertura do candle
      if (ctx.higher && ctx.higher.trend === 'baixa') {
        out.push(
          this.close(
            inst,
            s,
            t,
            'invalidado',
            null,
            `A escala maior (${ctx.higher.tfLabel}) mudou para baixa`,
          ),
        );
        continue;
      }
      // a ordem stop executa durante o pregão: confere o gatilho ANTES das invalidações que dependem
      // do fechamento (senão um candle que rompe e fecha fraco some como "invalidado", sem a perda)
      if (inst.state === 'armado' && t > inst.startIndex) {
        const entered = this.tryEnter(
          inst,
          s,
          t,
          this.p.exit,
          `Rompeu a máxima do candle anterior (${f(inst.trigger ?? 0)})`,
        );
        if (entered.length) {
          out.push(...entered);
          continue;
        }
      }
      // sem execução: invalidações pelo fechamento
      const pbLow = lowestLow(s, inst.m.swingIdx as number, t);
      if (c.close < (inst.m.priorLow as number)) {
        out.push(
          this.close(
            inst,
            s,
            t,
            'invalidado',
            null,
            'Perdeu o fundo anterior: recuo virou reversão',
          ),
        );
        continue;
      }
      if (s.v(ma, t) < s.v(ma, t - 1) && c.close < s.v(ma, t)) {
        out.push(
          this.close(
            inst,
            s,
            t,
            'invalidado',
            null,
            `A ${MA_LABEL[key]} virou para baixo e foi perdida`,
          ),
        );
        continue;
      }
      if (inst.state === 'armado' && t - inst.startIndex >= this.p.expiryBars) {
        out.push(
          this.close(inst, s, t, 'expirou', null, `Não acionou em ${this.p.expiryBars} candles`),
        );
        continue;
      }
      // (re)arma no fechamento de um candle na região da média
      const near =
        c.low <= s.v(ma, t) + this.p.nearAtr * atr && c.close >= s.v(ma, t) - this.p.nearAtr * atr;
      const score = near
        ? this.score(
            s,
            t,
            inst.m.swingIdx as number,
            inst.m.impulseStart as number,
            inst.m.priorLow as number,
            ctx,
          )
        : null;
      if (!score || (this.p.requireHealthy && (score.points < 2 || score.alerts.length > 0))) {
        // radar que não arma não pode ficar preso a um topo antigo e bloquear os recuos seguintes
        if (inst.state === 'radar' && t - inst.startIndex >= this.p.radarExpiryBars)
          out.push(
            this.close(
              inst,
              s,
              t,
              'expirou',
              null,
              `Não armou em ${this.p.radarExpiryBars} candles`,
            ),
          );
        continue;
      }
      const pattern = strongBull(s, t, ctx.pa)
        ? 'candle de força'
        : hammer(s, t, ctx.pa)
          ? 'martelo'
          : insideBar(s, t)
            ? 'inside bar'
            : null;
      const prevState = inst.state;
      inst.state = 'armado';
      inst.trigger = this.up(c.high, s);
      inst.stop = this.p.stopMode === 'pullback-low' ? this.down(pbLow, s) : this.down(c.low, s);
      if (prevState === 'radar') inst.startIndex = t;
      const relV = relVolume(s, t);
      out.push(
        this.ev(
          inst,
          'armado',
          s,
          t,
          inst.trigger,
          `${pattern ? `${pattern[0]?.toUpperCase()}${pattern.slice(1)}` : 'Candle'} na região da ${MA_LABEL[key]}: compra se romper a máxima${Number.isFinite(relV) && relV > 1 ? ' (volume crescente)' : ''}`,
          {
            score: score.points + (pattern ? 1 : 0),
            notes: [...score.notes, ...score.alerts.map((a) => `⚠ ${a}`)],
            refs: [inst.m.swingIdx as number, t],
          },
        ),
      );
    }

    return out;
  }

  /** Pontua o recuo entre o topo `swing` e t. */
  private score(
    s: SeriesBuffer,
    t: number,
    swing: number,
    impulseStart: number,
    priorLow: number,
    ctx: StepContext,
  ) {
    const notes: string[] = [];
    const alerts: string[] = [];
    let points = 0;
    if (volumeDrying(s, swing + 1, t)) {
      points++;
      notes.push('volume secando no recuo');
    }
    const avgRange = (a: number, b: number) => {
      let sum = 0;
      let n = 0;
      for (let k = a; k <= b; k++) {
        const c = s.c(k);
        sum += c.high - c.low;
        n++;
      }
      return n ? sum / n : Number.NaN;
    };
    const pb = avgRange(swing + 1, t);
    const imp = avgRange(impulseStart, swing);
    if (pb < this.p.smallerRangeRatio * imp) {
      points++;
      notes.push('candles do recuo menores que os do impulso');
    }
    if (lowestLow(s, swing + 1, t) > priorLow) {
      points++;
      notes.push('fundo anterior preservado');
    }
    for (let k = swing + 1; k <= t; k++) {
      const c = s.c(k);
      if (c.close < c.open && relVolume(s, k) >= ctx.pa.volHigh) {
        alerts.push('queda com volume alto no recuo');
        break;
      }
    }
    for (let k = swing + 1; k <= t; k++) {
      if (strongBear(s, k, ctx.pa)) {
        alerts.push('barra de força de baixa no recuo');
        break;
      }
    }
    return { points: points - alerts.length, notes, alerts };
  }
}
