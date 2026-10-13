import type { AlertCondition, Candle, DrawingPoint, Timeframe } from '@radar/shared';
import { INDICATOR_RULE_LABEL, formatNumber } from '@radar/shared';
import { TimeIndex } from '../candles/time-index';
import { EmaStream, SmaStream } from '../indicators/averages';
import { BollingerStream, DmiStream } from '../indicators/volatility';
import { DEFAULT_SETUP_PARAMS, type SetupParams } from '../setups/params';
import { SetupEngine } from '../setups/engine';
import {
  EXIT_LABEL,
  SETUP_LABEL,
  STATE_LABEL,
  type Fundamentals,
  type SetupEvent,
} from '../setups/types';

/**
 * Avaliação de alertas (SPEC §10). Lógica pura e incremental: o servidor alimenta candles da fonte e
 * recebe "disparos". Regras gerais:
 * - "no toque" (intrabar) olha a máxima/mínima do candle em formação; "no fechamento" só o candle fechado;
 * - todo alerta é de BORDA: dispara quando a condição passa de falsa para verdadeira, nunca enquanto
 *   ela continua verdadeira (evita repetição);
 * - o histórico usado para aquecer (warmup) nunca dispara.
 */

export interface AlertHit {
  alertId: string;
  /** Início do candle que provocou o disparo (UTC ms). */
  candleTime: number;
  price: number;
  /** O que aconteceu, em PT-BR curto (sem ativo/escala — o servidor completa). */
  text: string;
  /** Sufixo de anti-duplicação (o servidor junta com o id do alerta). */
  dedup: string;
}

/** Geometria de desenho resolvida pelo servidor (o alerta guarda só o id do desenho). */
export interface DrawingGeometry {
  kind: 'hline' | 'trend' | 'ray' | 'zone';
  points: DrawingPoint[];
}

export interface RuntimeAlert {
  id: string;
  condition: AlertCondition;
  trigger: 'touch' | 'close';
  /** Obrigatório quando condition.kind === 'drawing'. */
  drawing?: DrawingGeometry;
}

interface View {
  timeIndex(): TimeIndex;
  fmt(n: number): string;
}

interface Evaluator {
  /** Recebe cada candle FECHADO (inclusive no aquecimento, com `live=false`). */
  onClose(c: Candle, live: boolean): AlertHit[];
  /** Recebe o candle em formação (só ao vivo). */
  onForming(c: Candle): AlertHit[];
}

type Side = 'above' | 'below';

/**
 * Cruzamento de um nível (fixo ou que muda com o tempo, como uma linha de tendência).
 * Guarda de que lado o preço estava; dispara ao passar para o outro lado na direção pedida.
 */
class CrossEvaluator implements Evaluator {
  private side: Side | null = null;

  constructor(
    private readonly a: RuntimeAlert,
    private readonly levelAt: (time: number) => number,
    private readonly direction: 'up' | 'down',
    private readonly label: string,
    private readonly view: View,
  ) {}

  private hit(c: Candle, level: number, how: string): AlertHit {
    const verb = this.direction === 'up' ? 'cruzou para cima' : 'cruzou para baixo';
    return {
      alertId: this.a.id,
      candleTime: c.time,
      price: level,
      text: `${how} ${verb} ${this.label} ${this.view.fmt(level)}`,
      dedup: `${c.time}:${this.direction}`,
    };
  }

  onClose(c: Candle, live: boolean): AlertHit[] {
    const level = this.levelAt(c.time);
    if (!Number.isFinite(level)) return [];
    const now: Side = c.close >= level ? 'above' : 'below';
    const prev = this.side;
    this.side = now;
    if (!live || this.a.trigger !== 'close' || prev === null) return [];
    if (this.direction === 'up' && prev === 'below' && now === 'above')
      return [this.hit(c, level, 'Fechamento')];
    if (this.direction === 'down' && prev === 'above' && now === 'below')
      return [this.hit(c, level, 'Fechamento')];
    return [];
  }

  onForming(c: Candle): AlertHit[] {
    if (this.a.trigger !== 'touch' || this.side === null) return [];
    const level = this.levelAt(c.time);
    if (!Number.isFinite(level)) return [];
    if (this.direction === 'up' && this.side === 'below' && c.high >= level) {
      this.side = 'above';
      return [this.hit(c, level, 'Preço')];
    }
    if (this.direction === 'down' && this.side === 'above' && c.low <= level) {
      this.side = 'below';
      return [this.hit(c, level, 'Preço')];
    }
    // rearme no toque: o preço voltou para o lado de origem
    if (this.direction === 'up' && this.side === 'above' && c.close < level) this.side = 'below';
    if (this.direction === 'down' && this.side === 'below' && c.close > level) this.side = 'above';
    return [];
  }
}

/** Entrada/saída de uma zona de preço (a faixa vale para a direita, sem limite de tempo). */
class ZoneEvaluator implements Evaluator {
  private inside: boolean | null = null;
  private readonly lo: number;
  private readonly hi: number;

  constructor(
    private readonly a: RuntimeAlert,
    points: DrawingPoint[],
    private readonly event: 'enter' | 'exit',
    private readonly view: View,
  ) {
    const ps = points.map((p) => p.price);
    this.lo = Math.min(...ps);
    this.hi = Math.max(...ps);
  }

  private hit(c: Candle, price: number, how: string): AlertHit {
    const what = this.event === 'enter' ? 'entrou na zona' : 'saiu da zona';
    return {
      alertId: this.a.id,
      candleTime: c.time,
      price,
      text: `${how} ${what} ${this.view.fmt(this.lo)}–${this.view.fmt(this.hi)}`,
      dedup: `${c.time}:${this.event}`,
    };
  }

  onClose(c: Candle, live: boolean): AlertHit[] {
    const now = c.close >= this.lo && c.close <= this.hi;
    const prev = this.inside;
    this.inside = now;
    if (!live || this.a.trigger !== 'close' || prev === null || prev === now) return [];
    if (this.event === 'enter' && now) return [this.hit(c, c.close, 'Fechamento')];
    if (this.event === 'exit' && !now) return [this.hit(c, c.close, 'Fechamento')];
    return [];
  }

  onForming(c: Candle): AlertHit[] {
    if (this.a.trigger !== 'touch' || this.inside === null) return [];
    if (this.event === 'enter' && !this.inside && c.high >= this.lo && c.low <= this.hi) {
      this.inside = true;
      return [this.hit(c, c.close, 'Preço')];
    }
    if (this.event === 'exit' && this.inside && (c.high > this.hi || c.low < this.lo)) {
      this.inside = false;
      return [this.hit(c, c.close, 'Preço')];
    }
    // rearme: voltou ao estado de origem
    const nowInside = c.close >= this.lo && c.close <= this.hi;
    if (this.event === 'enter' && this.inside && !nowInside) this.inside = false;
    if (this.event === 'exit' && !this.inside && nowInside) this.inside = true;
    return [];
  }
}

/** Condições de indicador, sempre no fechamento (SPEC §10: indicadores usam candle fechado). */
class IndicatorEvaluator implements Evaluator {
  private readonly ma: EmaStream | SmaStream;
  private readonly bb: BollingerStream;
  private readonly adx: DmiStream;
  private readonly hist: number[] = [];
  private prevFlag: boolean | null = null;

  constructor(
    private readonly a: RuntimeAlert,
    private readonly c: Extract<AlertCondition, { kind: 'indicator' }>,
    private readonly view: View,
  ) {
    this.ma = c.ma === 'sma' ? new SmaStream(c.period) : new EmaStream(c.period);
    this.bb = new BollingerStream(c.period, c.stdDev);
    this.adx = new DmiStream(c.period);
  }

  private maName() {
    return `${this.c.ma === 'sma' ? 'MMA' : 'MME'} ${this.c.period}`;
  }

  onClose(k: Candle, live: boolean): AlertHit[] {
    const c = this.c;
    let flag: boolean | null = null;
    let detail = '';
    switch (c.rule) {
      case 'ema-turn-up':
      case 'ema-turn-down': {
        const v = this.ma.next(k.close);
        this.hist.push(v);
        if (this.hist.length > 3) this.hist.shift();
        const [a, b, d] = this.hist;
        if (this.hist.length === 3 && [a, b, d].every((x) => Number.isFinite(x))) {
          // "virou para cima": MA[t] > MA[t−1] e MA[t−1] ≤ MA[t−2] (SPEC §8.1); para baixo, espelhado
          flag =
            c.rule === 'ema-turn-up'
              ? (d as number) > (b as number) && (b as number) <= (a as number)
              : (d as number) < (b as number) && (b as number) >= (a as number);
          detail = `${this.maName()} ${this.view.fmt(d as number)}`;
        }
        break;
      }
      case 'close-below-bb':
      case 'close-above-bb': {
        const v = this.bb.next(k.close);
        if (Number.isFinite(v.lower)) {
          flag = c.rule === 'close-below-bb' ? k.close < v.lower : k.close > v.upper;
          const band = c.rule === 'close-below-bb' ? v.lower : v.upper;
          detail = `Bollinger ${c.period}/${formatNumber(c.stdDev, 1)} em ${this.view.fmt(band)}`;
        }
        break;
      }
      case 'adx-above':
      case 'adx-below': {
        const v = this.adx.next(k).adx;
        if (Number.isFinite(v)) {
          flag = c.rule === 'adx-above' ? v > c.level : v < c.level;
          detail = `ADX ${formatNumber(v, 1)} (nível ${formatNumber(c.level, 0)})`;
        }
        break;
      }
      case 'close-cross-ma-up':
      case 'close-cross-ma-down': {
        const v = this.ma.next(k.close);
        if (Number.isFinite(v)) {
          flag = c.rule === 'close-cross-ma-up' ? k.close > v : k.close < v;
          detail = `${this.maName()} ${this.view.fmt(v)}`;
        }
        break;
      }
    }
    const prev = this.prevFlag;
    if (flag !== null) this.prevFlag = flag;
    if (!live || flag !== true) return [];
    // borda: a condição precisa ter sido falsa no candle anterior ("virar" já é um evento de 1 candle)
    const turn = c.rule === 'ema-turn-up' || c.rule === 'ema-turn-down';
    if (!turn && prev !== false) return [];
    return [
      {
        alertId: this.a.id,
        candleTime: k.time,
        price: k.close,
        text: `${INDICATOR_RULE_LABEL[c.rule]} — ${detail}; fechamento ${this.view.fmt(k.close)}`,
        dedup: `${k.time}:${c.rule}`,
      },
    ];
  }

  onForming(): AlertHit[] {
    return [];
  }
}

/** Preço de uma linha desenhada (tendência/raio) num instante, no espaço de BARRAS do gráfico. */
export function lineLevelAt(points: DrawingPoint[], idx: TimeIndex, time: number): number {
  const [p1, p2] = points;
  if (!p1 || !p2) return Number.NaN;
  const x1 = idx.toLogical(p1.time);
  const x2 = idx.toLogical(p2.time);
  if (x1 === x2) return Number.NaN;
  const x = idx.toLogical(time);
  return p1.price + ((p2.price - p1.price) * (x - x1)) / (x2 - x1);
}

export interface AlertRuntimeOptions {
  tf: Timeframe;
  tz: string;
  tick: number;
  setupParams?: SetupParams;
  /** Casas decimais para os textos. */
  decimals?: number;
  /** Máximo de candles fechados mantidos em memória. */
  maxCandles?: number;
  /** Fundamentos conhecidos hoje (reflexividade); null = não verificado. */
  fundamentals?: Fundamentals | null;
}

/**
 * Tudo que um (usuário, ativo, escala) precisa para avaliar alertas: candles, avaliadores e o motor de
 * setups compartilhado. O servidor cria um por série e alimenta com a fonte de dados.
 */
export class AlertRuntime {
  private closed: Candle[] = [];
  private forming: Candle | null = null;
  private readonly evals = new Map<string, Evaluator>();
  private readonly alerts = new Map<string, RuntimeAlert>();
  private setupEngine: SetupEngine | null = null;
  private idx: TimeIndex | null = null;
  private readonly view: View;
  private fundamentals: Fundamentals | null;

  constructor(private readonly opts: AlertRuntimeOptions) {
    this.fundamentals = opts.fundamentals ?? null;
    const decimals = opts.decimals ?? 2;
    this.view = {
      timeIndex: () => {
        if (!this.idx) {
          const times = this.closed.map((c) => c.time);
          if (this.forming) times.push(this.forming.time);
          this.idx = new TimeIndex(times);
        }
        return this.idx;
      },
      fmt: (n) => formatNumber(n, decimals),
    };
  }

  get size(): number {
    return this.alerts.size;
  }

  /** Troca os fundamentos (o servidor atualiza de tempos em tempos); vale a partir do próximo candle. */
  setFundamentals(f: Fundamentals | null): void {
    this.fundamentals = f;
  }

  get lastClosedTime(): number | null {
    return this.closed.at(-1)?.time ?? null;
  }

  get candleCount(): number {
    return this.closed.length;
  }

  /** Carrega o histórico (sem disparar nada). `lastOpen` = o último candle ainda está em formação. */
  warmup(candles: readonly Candle[], lastOpen: boolean): void {
    const n = candles.length;
    this.closed = (lastOpen ? candles.slice(0, n - 1) : candles.slice()) as Candle[];
    this.forming = lastOpen ? (candles[n - 1] ?? null) : null;
    this.idx = null;
    this.setupEngine = null;
    for (const a of [...this.alerts.values()]) this.add(a);
  }

  /** Adiciona (ou substitui) um alerta, aquecendo-o com o histórico já carregado. */
  add(a: RuntimeAlert): void {
    this.alerts.set(a.id, a);
    const ev = this.makeEvaluator(a);
    if (ev) {
      for (const c of this.closed) ev.onClose(c, false);
      this.evals.set(a.id, ev);
    } else this.evals.delete(a.id);
    if (a.condition.kind === 'setup' && !this.setupEngine) this.buildSetups();
  }

  remove(id: string): void {
    this.alerts.delete(id);
    this.evals.delete(id);
    if (![...this.alerts.values()].some((a) => a.condition.kind === 'setup')) {
      this.setupEngine = null;
    }
  }

  private buildSetups(): void {
    const params = this.opts.setupParams ?? DEFAULT_SETUP_PARAMS;
    // o motor acompanha a escala maior sozinho (incremental): nada aqui depende do array `closed`,
    // que é cortado em maxCandles
    const engine = new SetupEngine({
      params,
      tick: this.opts.tick,
      tf: this.opts.tf,
      tz: this.opts.tz,
      fundamentalsAt: () => this.fundamentals,
    });
    for (const c of this.closed) engine.push(c);
    engine.events.length = 0;
    this.setupEngine = engine;
  }

  private makeEvaluator(a: RuntimeAlert): Evaluator | null {
    const c = a.condition;
    switch (c.kind) {
      case 'price':
        return new CrossEvaluator(a, () => c.level, c.direction, 'o nível', this.view);
      case 'drawing': {
        const d = a.drawing;
        if (!d || d.points.length === 0) return null;
        if (d.kind === 'zone') {
          if (c.event !== 'enter' && c.event !== 'exit') return null;
          return new ZoneEvaluator(a, d.points, c.event, this.view);
        }
        if (c.event !== 'cross-up' && c.event !== 'cross-down') return null;
        const dir = c.event === 'cross-up' ? 'up' : 'down';
        if (d.kind === 'hline') {
          const price = d.points[0]!.price;
          return new CrossEvaluator(a, () => price, dir, 'a linha', this.view);
        }
        // tendência e raio: prolongados para a direita (decisão nossa, ver DECISIONS)
        return new CrossEvaluator(
          a,
          (t) => lineLevelAt(d.points, this.view.timeIndex(), t),
          dir,
          'a linha de tendência',
          this.view,
        );
      }
      case 'indicator':
        return new IndicatorEvaluator(a, c, this.view);
      case 'setup':
      case 'system':
        return null;
    }
  }

  /**
   * Alimenta um candle vindo da fonte. Candles antigos ou repetidos (reconexão) são ignorados.
   * Se chegar um candle em formação mais novo sem o fechamento do anterior, o anterior é fechado.
   */
  update(candle: Candle, closed: boolean): AlertHit[] {
    const last = this.lastClosedTime;
    if (last !== null && candle.time <= last) return [];
    const out: AlertHit[] = [];
    if (this.forming && candle.time > this.forming.time) {
      out.push(...this.close(this.forming));
    }
    if (closed) {
      out.push(...this.close(candle));
      this.forming = null;
    } else {
      const isNew = !this.forming || this.forming.time !== candle.time;
      this.forming = candle;
      if (isNew) this.idx = null;
      for (const ev of this.evals.values()) out.push(...ev.onForming(candle));
    }
    return out;
  }

  private close(c: Candle): AlertHit[] {
    this.closed.push(c);
    this.forming = null;
    this.idx = null;
    const max = this.opts.maxCandles ?? 5000;
    if (this.closed.length > max) this.closed.splice(0, this.closed.length - max);
    const out: AlertHit[] = [];
    for (const ev of this.evals.values()) out.push(...ev.onClose(c, true));
    if (this.setupEngine) {
      const events = this.setupEngine.push(c);
      this.setupEngine.events.length = 0;
      out.push(...this.setupHits(events, c));
    }
    return out;
  }

  private setupHits(events: SetupEvent[], c: Candle): AlertHit[] {
    const out: AlertHit[] = [];
    for (const a of this.alerts.values()) {
      const cond = a.condition;
      if (cond.kind !== 'setup') continue;
      for (const e of events) {
        if (!cond.setups.includes(e.setup)) continue;
        if (!cond.states.includes(e.state)) continue;
        if (!cond.sides.includes(e.side)) continue;
        const side = e.side === 'sell' ? ' (venda)' : '';
        const exit = e.exit ? ` (${EXIT_LABEL[e.exit]})` : '';
        const r =
          e.resultR !== undefined
            ? `, ${e.resultR >= 0 ? '+' : ''}${formatNumber(e.resultR, 2)}R`
            : '';
        // aviso vermelho (SPEC §9) também chega na notificação
        const red = e.againstHigher
          ? ` ${e.notes?.find((n) => n.startsWith('⚠ Aviso vermelho')) ?? '⚠ Aviso vermelho: contra a escala maior'}`
          : '';
        out.push({
          alertId: a.id,
          candleTime: c.time,
          price: e.price ?? c.close,
          text: `${SETUP_LABEL[e.setup]}${side}: ${STATE_LABEL[e.state]}${exit}${r} — ${e.reason}${red}`,
          dedup: `${e.id}:${e.state}:${e.index}`,
        });
      }
    }
    return out;
  }
}
