import {
  heikinAshi,
  periodKey,
  type IndicatorOutput,
  type IndicatorPreset,
  type Pane,
} from '@radar/core';
import type { Candle, SymbolMeta, Timeframe } from '@radar/shared';
import { formatNumber, formatVolume, timeframeRank } from '@radar/shared';
import { SETUP_LABEL, type SetupEvent, type SetupId } from '@radar/core';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { ChartType } from '../lib/prefs';
import { chartTimeLabel, fromChartTime, tickLabel, toChartTime } from './time';
import { DrawingManager, type DrawingCallbacks } from './drawings/manager';
import type { OpenSetup, TailValue } from './indicator-worker';

const SHORT: Record<SetupId, string> = {
  s91: '9.1',
  s92: '9.2',
  s93: '9.3',
  pullback: 'RM',
  consolidation: 'CONS',
  elastic: 'ELA',
  reflexivity: 'REF',
};

/** Painéis que ganham área própria. ATR fica só na legenda (SPEC: "ATR 14 (exibição)"). */
const SUB_PANES: readonly Pane[] = ['volume', 'adx', 'macd', 'rsi', 'stochastic'];

export interface HoverInfo {
  time: number; // UTC ms real
  candle: Candle | null;
  values: { label: string; color: string; value: number; pane: Pane }[];
}

export interface ControllerOptions {
  tf: Timeframe;
  chartType: ChartType;
  upColor: string;
  downColor: string;
  onHover(info: HoverInfo | null): void;
  onCrosshairTime?(timeMs: number | null, tf: Timeframe): void;
  /** Liga a camada de desenhos (ativo + callbacks de persistência). */
  drawing?: { symbolId: string; callbacks: DrawingCallbacks };
}

/**
 * Controla um gráfico da Lightweight Charts: candles, volume, indicadores e cursor.
 * Mantém os dados reais (não Heikin-Ashi) para a legenda e para os indicadores.
 */
export class ChartController {
  readonly chart: IChartApi;
  private price: ISeriesApi<SeriesType>;
  private volume: ISeriesApi<'Histogram'> | null = null;
  private lines = new Map<string, ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>();
  private outputs: IndicatorOutput[] = [];
  private candles: Candle[] = [];
  private meta: SymbolMeta | null = null;
  private paneIndex = new Map<Pane, number>();
  private syncing = false;
  private disposed = false;
  private lastTimesLen = 0;
  readonly drawings: DrawingManager | null = null;
  private markers: ISeriesMarkersPluginApi<Time> | null = null;
  private setupLines: IPriceLine[] = [];

  constructor(
    container: HTMLElement,
    private readonly preset: IndicatorPreset,
    private readonly opts: ControllerOptions,
  ) {
    const tf = opts.tf;
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0b1120' },
        textColor: '#cbd5e1',
        fontSize: 11,
        attributionLogo: true, // exigência da licença da Lightweight Charts (ADR-0003)
        panes: { separatorColor: '#1f2937', separatorHoverColor: '#334155', enableResize: true },
      },
      grid: { vertLines: { color: '#111827' }, horzLines: { color: '#111827' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1f2937' },
      timeScale: {
        borderColor: '#1f2937',
        rightOffset: 6,
        timeVisible: timeframeRank(tf) < timeframeRank('1d'),
        secondsVisible: false,
        tickMarkFormatter: (t: Time, type: number) => tickLabel(t as number, type),
      },
      localization: {
        locale: 'pt-BR',
        timeFormatter: (t: Time) => chartTimeLabel(t as number, tf),
      },
    });
    this.price = this.createPriceSeries();
    this.layoutPanes();
    if (opts.drawing) {
      this.drawings = new DrawingManager(
        this.chart,
        this.price,
        container,
        tf,
        opts.drawing.symbolId,
        opts.drawing.callbacks,
      );
    }
    this.chart.subscribeCrosshairMove(this.onCrosshair);
  }

  /** Formato de preço no padrão brasileiro (vírgula decimal), com as casas do ativo. */
  private priceFmt() {
    const dec = this.meta?.priceDecimals ?? 2;
    return {
      type: 'custom' as const,
      minMove: this.meta?.tickSize ?? 0.01,
      formatter: (p: number) => formatNumber(p, dec),
    };
  }

  private paneFmt(pane: Pane) {
    if (pane === 'price') return this.priceFmt();
    if (pane === 'volume')
      return { type: 'custom' as const, minMove: 1, formatter: (v: number) => formatVolume(v) };
    return { type: 'custom' as const, minMove: 0.01, formatter: (v: number) => formatNumber(v, 1) };
  }

  private createPriceSeries(): ISeriesApi<SeriesType> {
    const { upColor, downColor } = this.opts;
    if (this.opts.chartType === 'line') {
      return this.chart.addSeries(LineSeries, { color: '#e2e8f0', lineWidth: 2 });
    }
    return this.chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      borderUpColor: upColor,
      borderDownColor: downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });
  }

  /** Define quais painéis existem e a ordem (o de preço é sempre o 0). */
  private layoutPanes(): void {
    const enabled = new Set<Pane>();
    for (const i of this.preset.indicators) {
      if (!i.enabled) continue;
      const pane: Pane =
        i.kind === 'volume'
          ? 'volume'
          : i.kind === 'adx'
            ? 'adx'
            : i.kind === 'macd'
              ? 'macd'
              : i.kind === 'rsi'
                ? 'rsi'
                : i.kind === 'stochastic'
                  ? 'stochastic'
                  : 'price';
      enabled.add(pane);
    }
    let idx = 1;
    this.paneIndex.set('price', 0);
    for (const p of SUB_PANES) if (enabled.has(p)) this.paneIndex.set(p, idx++);
    if (this.paneIndex.has('volume')) {
      this.volume = this.chart.addSeries(
        HistogramSeries,
        { priceFormat: this.paneFmt('volume'), priceLineVisible: false, lastValueVisible: false },
        this.paneIndex.get('volume'),
      );
    }
  }

  private applyPaneSizes(): void {
    const panes = this.chart.panes();
    panes[0]?.setStretchFactor(4);
    for (let i = 1; i < panes.length; i++) panes[i]?.setStretchFactor(1);
  }

  private toPriceData(c: Candle, i: number, ha: Candle[] | null) {
    const t = toChartTime(c.time, this.opts.tf);
    if (this.opts.chartType === 'line') return { time: t, value: c.close };
    const src = ha ? (ha[i] as Candle) : c;
    return { time: t, open: src.open, high: src.high, low: src.low, close: src.close };
  }

  private volBar(c: Candle) {
    return {
      time: toChartTime(c.time, this.opts.tf),
      value: c.volume,
      color: c.close >= c.open ? `${this.opts.upColor}66` : `${this.opts.downColor}66`,
    };
  }

  setData(candles: Candle[], meta: SymbolMeta, visibleBars: number): void {
    this.candles = candles;
    this.meta = meta;
    this.price.applyOptions({ priceFormat: this.priceFmt() });
    const ha = this.opts.chartType === 'heikin' ? heikinAshi(candles) : null;
    this.price.setData(candles.map((c, i) => this.toPriceData(c, i, ha)) as never);
    if (this.volume) {
      const showVol = meta.volume !== 'none';
      this.volume.setData(showVol ? candles.map((c) => this.volBar(c)) : []);
    }
    const n = candles.length;
    if (n)
      this.chart
        .timeScale()
        .setVisibleLogicalRange({ from: Math.max(0, n - visibleBars), to: n + 4 });
    this.lastTimesLen = n;
    this.drawings?.setCandleTimes(candles.map((c) => c.time));
    this.applyPaneSizes();
  }

  update(candle: Candle): void {
    const n = this.candles.length;
    // this.candles é a mesma referência mantida pela LiveSeries (já atualizada)
    const i = n - 1;
    if (this.opts.chartType === 'heikin') {
      const ha = heikinAshi(this.candles.slice(Math.max(0, n - 300)));
      this.price.update(this.toPriceData(candle, ha.length - 1, ha) as never);
    } else {
      this.price.update(this.toPriceData(candle, i, null) as never);
    }
    if (this.volume && this.meta?.volume !== 'none') this.volume.update(this.volBar(candle));
    if (this.drawings && n !== this.lastTimesLen) {
      this.lastTimesLen = n;
      this.drawings.setCandleTimes(this.candles.map((c) => c.time));
    }
  }

  /** Aplica todos os indicadores (resultado completo do worker). */
  setIndicators(outputs: IndicatorOutput[]): void {
    this.outputs = outputs;
    const times = this.candles.map((c) => toChartTime(c.time, this.opts.tf));
    for (const out of outputs) {
      if (out.pane === 'atr') continue;
      const paneIdx = this.paneIndex.get(out.pane) ?? 0;
      for (const line of out.lines) {
        const key = `${out.id}.${line.key}`;
        if (out.pane === 'volume' && line.key === 'volume') continue; // barras já desenhadas
        let s = this.lines.get(key);
        if (!s) {
          if (line.style === 'histogram') {
            s = this.chart.addSeries(
              HistogramSeries,
              {
                color: line.color,
                priceLineVisible: false,
                lastValueVisible: false,
                priceFormat: this.paneFmt(out.pane),
              },
              paneIdx,
            );
          } else if (line.style === 'dots') {
            s = this.chart.addSeries(
              LineSeries,
              {
                color: line.color,
                lineVisible: false,
                pointMarkersVisible: true,
                pointMarkersRadius: 1.6,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
                priceFormat: this.paneFmt(out.pane),
              },
              paneIdx,
            );
          } else {
            s = this.chart.addSeries(
              LineSeries,
              {
                color: line.color,
                lineWidth: line.lineWidth as 1 | 2 | 3 | 4,
                lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
                lineType: line.style === 'step' ? LineType.WithSteps : LineType.Simple,
                priceLineVisible: false,
                lastValueVisible: out.pane !== 'price',
                crosshairMarkerVisible: false,
                priceFormat: this.paneFmt(out.pane),
              },
              paneIdx,
            );
            if (out.levels && line === out.lines[0]) {
              for (const lv of out.levels) {
                s.createPriceLine({
                  price: lv,
                  color: '#475569',
                  lineStyle: LineStyle.Dotted,
                  lineWidth: 1,
                  axisLabelVisible: true,
                  title: '',
                });
              }
            }
          }
          this.lines.set(key, s);
        }
        const colors = line.colors;
        const data = line.values.map((v, i) => {
          const time = times[i] as UTCTimestamp;
          if (!Number.isFinite(v)) return { time };
          const color = colors?.[i];
          return color ? { time, value: v, color } : { time, value: v };
        });
        s.setData(data);
      }
    }
    this.applyPaneSizes();
  }

  /** Atualiza só o último valor de cada linha (resultado incremental do worker). */
  applyTail(time: number, tail: TailValue[]): void {
    const t = toChartTime(time, this.opts.tf);
    for (const v of tail) {
      const out = this.outputs.find((o) => o.id === v.id);
      const line = out?.lines.find((l) => l.key === v.line);
      if (line) {
        // mantém a cópia local coerente para a legenda
        const last = this.candles.length - 1;
        line.values[last] = v.value;
        line.values.length = this.candles.length;
        if (line.colors && v.color) {
          line.colors[last] = v.color;
          line.colors.length = this.candles.length;
        }
      }
      const s = this.lines.get(`${v.id}.${v.line}`);
      if (!s) continue;
      if (!Number.isFinite(v.value)) s.update({ time: t });
      else
        s.update(
          v.color ? { time: t, value: v.value, color: v.color } : { time: t, value: v.value },
        );
    }
  }

  private indexAtChartTime(t: number): number {
    // busca binária pelo candle com o tempo exibido igual a t
    const target = fromChartTime(t, this.opts.tf);
    let lo = 0;
    let hi = this.candles.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const ct = (this.candles[mid] as Candle).time;
      if (ct === target) return mid;
      if (ct < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  hoverAt(index: number): HoverInfo | null {
    const c = this.candles[index];
    if (!c) return null;
    const values: HoverInfo['values'] = [];
    for (const out of this.outputs) {
      for (const l of out.lines) {
        const v = l.values[index];
        if (v === undefined || !Number.isFinite(v)) continue;
        if (out.pane === 'volume' && l.key === 'volume') continue;
        values.push({ label: l.label, color: l.color, value: v, pane: out.pane });
      }
    }
    return { time: c.time, candle: c, values };
  }

  lastHover(): HoverInfo | null {
    return this.hoverAt(this.candles.length - 1);
  }

  private onCrosshair = (p: MouseEventParams<Time>) => {
    if (this.disposed) return;
    if (p.time === undefined) {
      this.opts.onHover(this.lastHover());
      if (!this.syncing) this.opts.onCrosshairTime?.(null, this.opts.tf);
      return;
    }
    const i = this.indexAtChartTime(p.time as number);
    this.opts.onHover(this.hoverAt(i));
    if (!this.syncing && i >= 0)
      this.opts.onCrosshairTime?.((this.candles[i] as Candle).time, this.opts.tf);
  };

  /** Posiciona o cursor no candle que corresponde a `timeMs` vindo de outra escala. */
  syncCrosshair(timeMs: number | null, sourceTf: Timeframe): void {
    if (timeMs === null || !this.candles.length || !this.meta) {
      this.chart.clearCrosshairPosition();
      return;
    }
    const tf = this.opts.tf;
    const higher = timeframeRank(tf) >= timeframeRank(sourceTf);
    const key = higher ? periodKey(tf, this.meta.session.timezone)(timeMs) : timeMs;
    // último candle com time <= key (maior escala) ou primeiro com time >= key (menor escala)
    let idx = -1;
    let lo = 0;
    let hi = this.candles.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((this.candles[mid] as Candle).time <= key) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (!higher && (this.candles[idx]?.time ?? -1) < key)
      idx = Math.min(idx + 1, this.candles.length - 1);
    const c = this.candles[idx];
    if (!c) return;
    this.syncing = true;
    try {
      this.chart.setCrosshairPosition(c.close, toChartTime(c.time, tf), this.price);
    } finally {
      this.syncing = false;
    }
  }

  /** Marcadores dos setups no gráfico (SPEC §8): armado, acionado e resultado. */
  setSetupMarkers(
    events: readonly SetupEvent[],
    hidden: readonly SetupId[],
    showRadar: boolean,
  ): void {
    const tf = this.opts.tf;
    const list: SeriesMarker<Time>[] = [];
    const armed = new Set<string>();
    for (const e of events) {
      if (hidden.includes(e.setup)) continue;
      const buy = e.side === 'buy';
      const t = toChartTime(e.time, tf);
      const tag = SHORT[e.setup];
      if (e.state === 'radar') {
        if (!showRadar) continue;
        list.push({
          time: t,
          position: buy ? 'belowBar' : 'aboveBar',
          shape: 'circle',
          color: '#64748b',
          text: tag,
          size: 0.6,
          id: e.id + ':' + e.index,
        });
      } else if (e.state === 'armado') {
        // só o primeiro "armado" de cada ocorrência (as atualizações de gatilho poluem); sem texto
        // para não amontoar — o nome do setup vai na seta de entrada
        if (armed.has(e.id)) continue;
        armed.add(e.id);
        list.push({
          time: t,
          position: buy ? 'belowBar' : 'aboveBar',
          shape: buy ? 'arrowUp' : 'arrowDown',
          color: '#38bdf8',
          size: 0.6,
          id: e.id + ':armado',
        });
      } else if (e.state === 'acionado' && e.entryIndex === e.index && e.price === e.entry) {
        list.push({
          time: t,
          position: buy ? 'belowBar' : 'aboveBar',
          shape: buy ? 'arrowUp' : 'arrowDown',
          color: buy ? '#22c55e' : '#ef4444',
          text: `${tag} ${buy ? 'C' : 'V'}`,
          size: 1,
          id: e.id + ':entrada',
        });
      } else if (e.state === 'encerrado') {
        if (e.resultR !== undefined) {
          const r = e.resultR;
          list.push({
            time: t,
            position: buy ? 'aboveBar' : 'belowBar',
            shape: 'square',
            color: r >= 0 ? '#22c55e' : '#ef4444',
            text: `${r >= 0 ? '+' : ''}${formatNumber(r, 1)}R`,
            size: 0.7,
            id: e.id + ':fim',
          });
        }
      }
    }
    list.sort((a, b) => (a.time as number) - (b.time as number));
    if (!this.markers) this.markers = createSeriesMarkers(this.price, list);
    else this.markers.setMarkers(list);
  }

  /** Linhas de gatilho, stop e alvo das ocorrências abertas. */
  setOpenSetups(open: readonly OpenSetup[], hidden: readonly SetupId[]): void {
    for (const l of this.setupLines) this.price.removePriceLine(l);
    this.setupLines = [];
    for (const o of open) {
      if (hidden.includes(o.setup) || o.state === 'radar') continue;
      const name = SETUP_LABEL[o.setup].replace('Setup ', '');
      const add = (
        price: number | null,
        color: string,
        title: string,
        style = LineStyle.Dashed,
      ) => {
        if (price === null || !Number.isFinite(price)) return;
        this.setupLines.push(
          this.price.createPriceLine({
            price,
            color,
            lineWidth: 1,
            lineStyle: style,
            axisLabelVisible: true,
            title,
          }),
        );
      };
      if (o.state === 'armado') add(o.trigger, '#38bdf8', `Gatilho ${name}`);
      if (o.state === 'acionado') add(o.entry, '#e2e8f0', `Entrada ${name}`, LineStyle.Solid);
      add(o.stop, '#ef4444', `Stop ${name}`);
      add(o.target, '#22c55e', `Alvo ${name}`);
    }
  }

  /** Centraliza o gráfico num candle. */
  focusIndex(index: number): void {
    const half = 40;
    this.chart.timeScale().setVisibleLogicalRange({ from: index - half, to: index + half });
    const c = this.candles[index];
    if (c) this.chart.setCrosshairPosition(c.close, toChartTime(c.time, this.opts.tf), this.price);
  }

  dispose(): void {
    this.disposed = true;
    this.chart.unsubscribeCrosshairMove(this.onCrosshair);
    this.drawings?.dispose();
    this.chart.remove();
  }
}
