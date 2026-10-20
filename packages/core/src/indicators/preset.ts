import { z } from 'zod';
import type { Candle, Timeframe } from '@radar/shared';
import { isIntraday } from '@radar/shared';
import { EmaStream, SmaStream } from './averages';
import { MacdStream, RsiStream, StochasticStream, VwapStream } from './oscillators';
import type { Stream } from './stream';
import { AtrStream, BollingerStream, DmiStream, StopAtrStream } from './volatility';

/**
 * Configuração de indicadores (presets da SPEC §7). Persistida como JSON e editável na interface.
 */
const style = {
  color: z.string(),
  lineWidth: z.number().min(1).max(4).default(1),
  dashed: z.boolean().default(false),
};

export const indicatorConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ema'),
    id: z.string(),
    enabled: z.boolean(),
    period: z.number().int().min(1),
    ...style,
  }),
  z.object({
    kind: z.literal('sma'),
    id: z.string(),
    enabled: z.boolean(),
    period: z.number().int().min(1),
    ...style,
  }),
  z.object({
    kind: z.literal('bollinger'),
    id: z.string(),
    enabled: z.boolean(),
    period: z.number().int().min(2),
    stdDev: z.number().positive(),
    ...style,
  }),
  z.object({
    kind: z.literal('volume'),
    id: z.string(),
    enabled: z.boolean(),
    maPeriod: z.number().int().min(1),
    color: z.string(),
  }),
  z.object({
    kind: z.literal('adx'),
    id: z.string(),
    enabled: z.boolean(),
    period: z.number().int().min(1),
    levels: z.array(z.number()),
  }),
  z.object({
    kind: z.literal('atr'),
    id: z.string(),
    enabled: z.boolean(),
    period: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('stopAtr'),
    id: z.string(),
    enabled: z.boolean(),
    period: z.number().int().min(1),
    smoothing: z.enum(['ema', 'rma', 'sma']),
    /** Multiplicador por escala; escalas ausentes usam `defaultMultiplier`. */
    multipliers: z.record(z.string(), z.number().positive()),
    defaultMultiplier: z.number().positive(),
  }),
  z.object({
    kind: z.literal('macd'),
    id: z.string(),
    enabled: z.boolean(),
    fast: z.number().int().min(1),
    slow: z.number().int().min(1),
    signal: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('rsi'),
    id: z.string(),
    enabled: z.boolean(),
    period: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('stochastic'),
    id: z.string(),
    enabled: z.boolean(),
    period: z.number().int().min(1),
    kSmooth: z.number().int().min(1),
    dPeriod: z.number().int().min(1),
  }),
  z.object({ kind: z.literal('vwap'), id: z.string(), enabled: z.boolean(), color: z.string() }),
]);
export type IndicatorConfig = z.infer<typeof indicatorConfigSchema>;

export const indicatorPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  builtIn: z.boolean().default(false),
  indicators: z.array(indicatorConfigSchema),
});
export type IndicatorPreset = z.infer<typeof indicatorPresetSchema>;

/** Preset "Padrão do canal" (SPEC §7) — ligado por padrão. */
export const CHANNEL_PRESET: IndicatorPreset = {
  id: 'padrao-do-canal',
  name: 'Padrão do canal',
  builtIn: true,
  indicators: [
    {
      kind: 'ema',
      id: 'mme9',
      enabled: true,
      period: 9,
      color: '#ffffff',
      lineWidth: 3,
      dashed: true,
    },
    {
      kind: 'ema',
      id: 'mme21',
      enabled: true,
      period: 21,
      color: '#f5a524',
      lineWidth: 1,
      dashed: false,
    },
    {
      kind: 'sma',
      id: 'mma50',
      enabled: true,
      period: 50,
      color: '#3b82f6',
      lineWidth: 2,
      dashed: false,
    },
    {
      kind: 'sma',
      id: 'mma200',
      enabled: true,
      period: 200,
      color: '#c026d3',
      lineWidth: 2,
      dashed: false,
    },
    { kind: 'volume', id: 'volume', enabled: true, maPeriod: 21, color: '#f5a524' },
    { kind: 'adx', id: 'adx', enabled: true, period: 14, levels: [20, 25, 40] },
    { kind: 'atr', id: 'atr', enabled: true, period: 14 },
    {
      kind: 'stopAtr',
      id: 'stopatr',
      enabled: true,
      period: 20,
      smoothing: 'ema',
      multipliers: { '1w': 2, '1M': 2, '1d': 3 },
      defaultMultiplier: 3,
    },
    {
      kind: 'bollinger',
      id: 'bb3',
      enabled: true,
      period: 20,
      stdDev: 3,
      color: '#94a3b8',
      lineWidth: 1,
      dashed: false,
    },
    // Opcionais, desligados por padrão.
    { kind: 'macd', id: 'macd', enabled: false, fast: 12, slow: 26, signal: 9 },
    { kind: 'rsi', id: 'ifr', enabled: false, period: 14 },
    { kind: 'stochastic', id: 'estocastico', enabled: false, period: 14, kSmooth: 3, dPeriod: 3 },
    { kind: 'vwap', id: 'vwap', enabled: false, color: '#22d3ee' },
    {
      kind: 'bollinger',
      id: 'bb2',
      enabled: false,
      period: 20,
      stdDev: 2,
      color: '#64748b',
      lineWidth: 1,
      dashed: true,
    },
  ],
};

/** Preset "Limpo": só candles e volume. */
export const CLEAN_PRESET: IndicatorPreset = {
  id: 'limpo',
  name: 'Limpo',
  builtIn: true,
  indicators: CHANNEL_PRESET.indicators.map((i) => ({ ...i, enabled: i.kind === 'volume' })),
};

export const BUILT_IN_PRESETS: readonly IndicatorPreset[] = [CHANNEL_PRESET, CLEAN_PRESET];

/**
 * Preset do modo simples (ADR-0029): candles, UMA média (a MMA50, a mesma da regra de tendência) e
 * volume. Fica fora da lista de presets: o modo simples sempre usa este.
 */
export const SIMPLE_PRESET: IndicatorPreset = {
  id: 'simples',
  name: 'Simples',
  builtIn: true,
  indicators: CHANNEL_PRESET.indicators.map((i) => ({
    ...i,
    enabled: i.kind === 'volume' || i.id === 'mma50',
  })),
};

// ---------------------------------------------------------------------------------------------

export type Pane = 'price' | 'volume' | 'adx' | 'atr' | 'macd' | 'rsi' | 'stochastic';

export interface LineOutput {
  key: string;
  label: string;
  values: number[];
  color: string;
  lineWidth: number;
  dashed: boolean;
  /** Linha desenhada como pontos/degraus (Stop ATR). */
  style?: 'line' | 'step' | 'histogram' | 'dots';
  /** Cor por ponto (opcional), alinhada com `values`. */
  colors?: string[];
}

export interface IndicatorOutput {
  id: string;
  label: string;
  pane: Pane;
  lines: LineOutput[];
  levels?: number[];
}

/** Rótulo curto em PT-BR. */
export function indicatorLabel(cfg: IndicatorConfig): string {
  switch (cfg.kind) {
    case 'ema':
      return `MME ${cfg.period}`;
    case 'sma':
      return `MMA ${cfg.period}`;
    case 'bollinger':
      return `Bollinger ${cfg.period}/${cfg.stdDev}`;
    case 'volume':
      return `Volume (MMA ${cfg.maPeriod})`;
    case 'adx':
      return `ADX ${cfg.period}`;
    case 'atr':
      return `ATR ${cfg.period}`;
    case 'stopAtr':
      return `Stop ATR ${cfg.period}`;
    case 'macd':
      return `MACD ${cfg.fast}/${cfg.slow}/${cfg.signal}`;
    case 'rsi':
      return `IFR ${cfg.period}`;
    case 'stochastic':
      return `Estocástico ${cfg.period}/${cfg.kSmooth}/${cfg.dPeriod}`;
    case 'vwap':
      return 'VWAP';
  }
}

/** Aviso mostrado quando a VWAP está ligada numa escala diária ou maior. */
export const VWAP_INTRADAY_ONLY = 'VWAP só faz sentido no intradiário';

/**
 * Por que um indicador não é calculado nem desenhado nesta escala (`null` = é desenhado).
 * VWAP: recomeça a cada data local da bolsa; no diário, semanal e mensal cada candle tem data
 * própria e a "VWAP" seria só o preço típico do candle — enganosa. Decisão nossa: não desenhar.
 */
export function indicatorSkipReason(cfg: IndicatorConfig, tf: Timeframe): string | null {
  if (cfg.kind === 'vwap' && !isIntraday(tf)) return VWAP_INTRADAY_ONLY;
  return null;
}

export interface SkippedIndicator {
  id: string;
  label: string;
  reason: string;
}

/** Indicadores LIGADOS no preset que ficam de fora nesta escala, com o aviso para a legenda. */
export function skippedIndicators(preset: IndicatorPreset, tf: Timeframe): SkippedIndicator[] {
  const out: SkippedIndicator[] = [];
  for (const cfg of preset.indicators) {
    if (!cfg.enabled) continue;
    const reason = indicatorSkipReason(cfg, tf);
    if (reason) out.push({ id: cfg.id, label: indicatorLabel(cfg), reason });
  }
  return out;
}

export function stopAtrMultiplier(
  cfg: Extract<IndicatorConfig, { kind: 'stopAtr' }>,
  tf: Timeframe,
): number {
  return cfg.multipliers[tf] ?? cfg.defaultMultiplier;
}

/** Um "computador" incremental de indicador: avança com candles fechados e espia o em formação. */
interface Computer {
  output: IndicatorOutput;
  push(c: Candle, commit: boolean): void;
}

function makeComputer(
  cfg: IndicatorConfig,
  tf: Timeframe,
  sessionKey: (t: number) => number,
): Computer {
  const label = indicatorLabel(cfg);
  const line = (
    key: string,
    l: string,
    color: string,
    lineWidth = 1,
    dashed = false,
    st?: LineOutput['style'],
  ): LineOutput => ({
    key,
    label: l,
    values: [],
    color,
    lineWidth,
    dashed,
    ...(st ? { style: st } : {}),
  });

  // Helper genérico: um stream + função que distribui a saída nas linhas.
  function build<I, O>(
    stream: Stream<I, O>,
    input: (c: Candle) => I,
    output: IndicatorOutput,
    write: (o: O, lines: LineOutput[], c: Candle) => void,
  ): Computer {
    return {
      output,
      push(c, commit) {
        const o = commit ? stream.next(input(c)) : stream.peek(input(c));
        write(o, output.lines, c);
      },
    };
  }

  const close = (c: Candle) => c.close;
  const set = (l: LineOutput | undefined, v: number) => l?.values.push(v);

  switch (cfg.kind) {
    case 'ema':
    case 'sma': {
      const st = cfg.kind === 'ema' ? new EmaStream(cfg.period) : new SmaStream(cfg.period);
      return build(
        st,
        close,
        {
          id: cfg.id,
          label,
          pane: 'price',
          lines: [line('value', label, cfg.color, cfg.lineWidth, cfg.dashed)],
        },
        (o, ls) => set(ls[0], o),
      );
    }
    case 'bollinger':
      return build(
        new BollingerStream(cfg.period, cfg.stdDev),
        close,
        {
          id: cfg.id,
          label,
          pane: 'price',
          lines: [
            line('upper', `${label} sup.`, cfg.color, cfg.lineWidth, cfg.dashed),
            line('middle', `${label} média`, cfg.color, 1, true),
            line('lower', `${label} inf.`, cfg.color, cfg.lineWidth, cfg.dashed),
          ],
        },
        (o, ls) => {
          set(ls[0], o.upper);
          set(ls[1], o.middle);
          set(ls[2], o.lower);
        },
      );
    case 'volume':
      return build(
        new SmaStream(cfg.maPeriod),
        (c) => c.volume,
        {
          id: cfg.id,
          label,
          pane: 'volume',
          lines: [
            line('volume', 'Volume', '#64748b', 1, false, 'histogram'),
            line('ma', `MMA ${cfg.maPeriod}`, cfg.color),
          ],
        },
        (o, ls, c) => {
          set(ls[0], c.volume);
          set(ls[1], o);
        },
      );
    case 'adx':
      return build(
        new DmiStream(cfg.period),
        (c) => c,
        {
          id: cfg.id,
          label,
          pane: 'adx',
          levels: cfg.levels,
          lines: [
            line('adx', 'ADX', '#f8fafc', 2),
            line('plusDI', '+DI', '#22c55e'),
            line('minusDI', '−DI', '#ef4444'),
          ],
        },
        (o, ls) => {
          set(ls[0], o.adx);
          set(ls[1], o.plusDI);
          set(ls[2], o.minusDI);
        },
      );
    case 'atr':
      return build(
        new AtrStream(cfg.period, 'rma'),
        (c) => c,
        { id: cfg.id, label, pane: 'atr', lines: [line('atr', label, '#eab308')] },
        (o, ls) => set(ls[0], o),
      );
    case 'stopAtr': {
      const m = stopAtrMultiplier(cfg, tf);
      return build(
        new StopAtrStream(cfg.period, m, cfg.smoothing),
        (c) => c,
        {
          id: cfg.id,
          label: `${label} × ${m}`,
          pane: 'price',
          // Uma série só, desenhada como pontos coloridos: verde = acompanhando alta,
          // vermelho = acompanhando baixa. Linhas contínuas ligariam as lacunas nas viradas.
          lines: [{ ...line('stop', `Stop ATR × ${m}`, '#22c55e', 2, false, 'dots'), colors: [] }],
        },
        (o, ls) => {
          const l = ls[0];
          if (!l) return;
          l.values.push(o.stop);
          l.colors?.push(o.direction === -1 ? '#ef4444' : '#22c55e');
        },
      );
    }
    case 'macd':
      return build(
        new MacdStream(cfg.fast, cfg.slow, cfg.signal),
        close,
        {
          id: cfg.id,
          label,
          pane: 'macd',
          levels: [0],
          lines: [
            line('hist', 'Histograma', '#64748b', 1, false, 'histogram'),
            line('macd', 'MACD', '#3b82f6'),
            line('signal', 'Sinal', '#f97316'),
          ],
        },
        (o, ls) => {
          set(ls[0], o.histogram);
          set(ls[1], o.macd);
          set(ls[2], o.signal);
        },
      );
    case 'rsi':
      return build(
        new RsiStream(cfg.period),
        close,
        {
          id: cfg.id,
          label,
          pane: 'rsi',
          levels: [30, 50, 70],
          lines: [line('rsi', label, '#a78bfa')],
        },
        (o, ls) => set(ls[0], o),
      );
    case 'stochastic':
      return build(
        new StochasticStream(cfg.period, cfg.kSmooth, cfg.dPeriod),
        (c) => c,
        {
          id: cfg.id,
          label,
          pane: 'stochastic',
          levels: [20, 80],
          lines: [line('k', '%K', '#38bdf8'), line('d', '%D', '#f97316')],
        },
        (o, ls) => {
          set(ls[0], o.k);
          set(ls[1], o.d);
        },
      );
    case 'vwap':
      return build(
        new VwapStream(sessionKey),
        (c) => c,
        { id: cfg.id, label, pane: 'price', lines: [line('vwap', 'VWAP', cfg.color, 2)] },
        (o, ls) => set(ls[0], o),
      );
  }
}

export interface ComputeOptions {
  /** O último candle está em formação? (calculado com `peek`, sem avançar o estado). */
  lastOpen?: boolean;
  /** Chave de sessão para a VWAP (padrão: dia UTC). */
  sessionKey?: (t: number) => number;
}

/**
 * Motor incremental de indicadores (SPEC §19 — "recálculo incremental").
 * - `reset(candles)` calcula tudo do zero;
 * - `update(candle, closed)` acrescenta um candle fechado ou atualiza o candle em formação em O(1)
 *   por indicador (exceto correções de candles antigos, que forçam recálculo).
 */
export class IndicatorEngine {
  private comps: Computer[] = [];
  private candles: Candle[] = [];
  private formingTime: number | null = null;

  constructor(
    private readonly preset: IndicatorPreset,
    private readonly tf: Timeframe,
    private readonly sessionKey: (t: number) => number = (t) => Math.floor(t / 86_400_000),
  ) {}

  get outputs(): IndicatorOutput[] {
    return this.comps.map((c) => c.output);
  }

  reset(candles: readonly Candle[], lastOpen = false): IndicatorOutput[] {
    this.comps = this.preset.indicators
      .filter((i) => i.enabled && indicatorSkipReason(i, this.tf) === null)
      .map((cfg) => makeComputer(cfg, this.tf, this.sessionKey));
    this.candles = [];
    this.formingTime = null;
    const n = candles.length;
    for (let i = 0; i < n; i++) {
      const c = candles[i] as Candle;
      this.feed(c, !(lastOpen && i === n - 1));
    }
    return this.outputs;
  }

  /** Retorna 'append', 'replace' ou 'reset' (quando precisou recalcular tudo). */
  update(c: Candle, closed: boolean): 'append' | 'replace' | 'reset' {
    const lastClosed = this.lastClosedTime();
    if (lastClosed !== null && c.time <= lastClosed) {
      // Correção de candle já fechado: recalcula tudo (raro).
      const series = this.candles.filter((x) => x.time !== c.time && x.time !== this.formingTime);
      series.push(c);
      series.sort((a, b) => a.time - b.time);
      this.reset(series, !closed && c.time === series[series.length - 1]?.time);
      return 'reset';
    }
    let mode: 'append' | 'replace' = 'append';
    if (this.formingTime !== null) {
      this.popForming();
      mode = this.formingTimeWas === c.time ? 'replace' : 'append';
    }
    this.feed(c, closed);
    return mode;
  }

  private formingTimeWas: number | null = null;

  private lastClosedTime(): number | null {
    const n = this.candles.length;
    if (n === 0) return null;
    if (this.formingTime !== null) return n >= 2 ? (this.candles[n - 2] as Candle).time : null;
    return (this.candles[n - 1] as Candle).time;
  }

  private popForming(): void {
    this.formingTimeWas = this.formingTime;
    this.candles.pop();
    for (const comp of this.comps) {
      for (const l of comp.output.lines) {
        l.values.pop();
        l.colors?.pop();
      }
    }
    this.formingTime = null;
  }

  private feed(c: Candle, commit: boolean): void {
    this.candles.push(c);
    for (const comp of this.comps) comp.push(c, commit);
    this.formingTime = commit ? null : c.time;
  }
}

/** Calcula todos os indicadores ligados de um preset (modo lote). */
export function computeIndicators(
  candles: readonly Candle[],
  preset: IndicatorPreset,
  tf: Timeframe,
  options: ComputeOptions = {},
): IndicatorOutput[] {
  const engine = new IndicatorEngine(preset, tf, options.sessionKey);
  return engine.reset(candles, options.lastOpen ?? false);
}
