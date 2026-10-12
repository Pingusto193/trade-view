import { positionSize } from '@radar/core';
import type {
  Drawing,
  DrawingData,
  DrawingKind,
  DrawingPoint,
  SymbolMeta,
  Timeframe,
} from '@radar/shared';
import { DRAWING_POINTS, formatBRL, formatMoney, formatNumber } from '@radar/shared';
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { defaultTarget, extendRay, fibPrice, hitTest, lineAt, type P } from './geometry';
import { TimeIndex } from './time-index';

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface DrawingCallbacks {
  /** Desenho novo ou alterado (salvar). */
  commit(d: Drawing): void;
  select(id: string | null): void;
  /** Ferramenta terminou de criar o desenho. */
  toolDone(): void;
  /** Toque longo / clique direito num desenho. */
  context?(id: string): void;
  getMeta(): SymbolMeta | null;
  getRisk(): { capital: number; riskPct: number };
  newId(): string;
}

interface Draft {
  kind: DrawingKind;
  points: DrawingPoint[];
  hover: DrawingPoint | null;
}

interface Drag {
  id: string;
  target: number | 'body';
  startLogical: number;
  startPrice: number;
  orig: Drawing;
  moved: boolean;
}

function hexAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1] as string, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Camada de desenhos do gráfico: um "primitive" da Lightweight Charts que desenha todos os
 * desenhos do ativo e trata mouse/toque (criar, selecionar, arrastar).
 */
export class DrawingManager implements ISeriesPrimitive<Time> {
  private drawings: Drawing[] = [];
  private index = new TimeIndex([]);
  private tool: DrawingKind | null = null;
  private draft: Draft | null = null;
  private selectedId: string | null = null;
  private drag: Drag | null = null;
  private capturing = false;
  private requestUpdate: (() => void) | null = null;
  private longPress: ReturnType<typeof setTimeout> | null = null;
  private downAt: P | null = null;
  private readonly view: IPrimitivePaneView;

  constructor(
    private readonly chart: IChartApi,
    private readonly series: ISeriesApi<SeriesType>,
    private readonly container: HTMLElement,
    private readonly tf: Timeframe,
    private readonly symbolId: string,
    private readonly cb: DrawingCallbacks,
  ) {
    this.view = {
      zOrder: () => 'top',
      renderer: () => ({ draw: (t: Target) => this.render(t) }),
    };
    container.addEventListener('pointerdown', this.onDown, { capture: true });
    container.addEventListener('pointermove', this.onHover);
    container.addEventListener('mousedown', this.block, { capture: true });
    container.addEventListener('touchstart', this.block, { capture: true, passive: false });
    container.addEventListener('contextmenu', this.onContextMenu);
    series.attachPrimitive(this);
  }

  // ---------------------------------------------------------------- ciclo de vida (primitive)

  attached(p: SeriesAttachedParameter<Time>): void {
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  updateAllViews(): void {
    // a renderização lê o estado atual diretamente
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.hitAt({ x, y });
    if (!hit) return null;
    return {
      externalId: hit.d.id,
      zOrder: 'top',
      cursorStyle: hit.d.locked ? 'pointer' : hit.part === 'body' ? 'move' : 'grab',
    };
  }

  dispose(): void {
    this.container.removeEventListener('pointerdown', this.onDown, { capture: true });
    this.container.removeEventListener('pointermove', this.onHover);
    this.container.removeEventListener('mousedown', this.block, { capture: true });
    this.container.removeEventListener('touchstart', this.block, { capture: true });
    this.container.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    try {
      this.series.detachPrimitive(this);
    } catch {
      // gráfico já removido
    }
  }

  // ---------------------------------------------------------------- estado vindo de fora

  setCandleTimes(times: readonly number[]): void {
    this.index = new TimeIndex(times);
    this.redraw();
  }

  setDrawings(list: readonly Drawing[]): void {
    // durante um arrasto, mantém a versão local do desenho arrastado
    const dragging = this.drag ? this.drawings.find((d) => d.id === this.drag?.id) : null;
    this.drawings = list
      .filter((d) => d.tf === null || d.tf === this.tf)
      .map((d) => (dragging && d.id === dragging.id ? dragging : d));
    this.redraw();
  }

  setTool(tool: DrawingKind | null): void {
    this.tool = tool;
    this.draft = null;
    this.chart.applyOptions({ handleScroll: tool === null, handleScale: tool === null });
    this.container.style.cursor = tool ? 'crosshair' : '';
    this.redraw();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.redraw();
  }

  private redraw(): void {
    this.requestUpdate?.();
  }

  // ---------------------------------------------------------------- coordenadas

  private x(time: number): number | null {
    return this.chart.timeScale().logicalToCoordinate(this.index.toLogical(time) as Logical);
  }

  private y(price: number): number | null {
    return this.series.priceToCoordinate(price);
  }

  private local(e: PointerEvent): P {
    const r = this.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inPane(p: P): boolean {
    const size = this.chart.paneSize(0);
    return p.x >= 0 && p.y >= 0 && p.x <= this.chart.timeScale().width() && p.y <= size.height;
  }

  private toPoint(p: P): DrawingPoint | null {
    const logical = this.chart.timeScale().coordinateToLogical(p.x);
    const price = this.series.coordinateToPrice(p.y);
    if (logical === null || price === null) return null;
    return { time: this.index.toTime(logical, true), price };
  }

  private project(d: Drawing | { data: DrawingData }): P[] | null {
    const out: P[] = [];
    for (const pt of d.data.points) {
      const x = this.x(pt.time);
      const y = this.y(pt.price);
      if (x === null || y === null) return null;
      out.push({ x, y });
    }
    if (d.data.kind === 'position') {
      const ty = this.y(d.data.target);
      if (ty === null) return null;
      out.push({ x: (out[0] as P).x, y: ty });
    }
    return out;
  }

  private hitAt(p: P): { d: Drawing; part: number | 'body' } | null {
    const width = this.chart.timeScale().width();
    const height = this.chart.paneSize(0).height;
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i] as Drawing;
      if (d.hidden) continue;
      const pts = this.project(d);
      if (!pts) continue;
      const part = hitTest(d.data, { pts, width, height }, p, d.id === this.selectedId ? 10 : 7);
      if (part !== null) return { d, part };
    }
    return null;
  }

  // ---------------------------------------------------------------- eventos

  private block = (e: Event) => {
    if (this.capturing) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    }
  };

  private onContextMenu = (e: MouseEvent) => {
    const r = this.container.getBoundingClientRect();
    const hit = this.hitAt({ x: e.clientX - r.left, y: e.clientY - r.top });
    if (hit) {
      e.preventDefault();
      this.cb.select(hit.d.id);
      this.cb.context?.(hit.d.id);
    }
  };

  private onHover = (e: PointerEvent) => {
    if (!this.draft || this.drag) return;
    const pt = this.toPoint(this.local(e));
    if (pt) {
      this.draft.hover = pt;
      this.redraw();
    }
  };

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = this.local(e);
    if (!this.inPane(p)) return;

    if (this.tool) {
      this.capture(e);
      const pt = this.toPoint(p);
      if (!pt) return;
      if (!this.draft) this.draft = { kind: this.tool, points: [], hover: null };
      this.draft.points.push(pt);
      if (this.draft.points.length >= DRAWING_POINTS[this.draft.kind]) this.finishDraft();
      this.redraw();
      return;
    }

    const hit = this.hitAt(p);
    if (!hit) {
      if (this.selectedId) this.cb.select(null);
      return;
    }
    this.cb.select(hit.d.id);
    this.downAt = p;
    if (e.pointerType !== 'mouse') {
      this.longPress = setTimeout(() => this.cb.context?.(hit.d.id), 550);
    }
    if (hit.d.locked) return; // travado: só seleciona; o gráfico continua rolando
    this.capture(e);
    const logical = this.chart.timeScale().coordinateToLogical(p.x) ?? 0;
    const price = this.series.coordinateToPrice(p.y) ?? 0;
    this.drag = {
      id: hit.d.id,
      target: hit.part,
      startLogical: logical,
      startPrice: price,
      orig: structuredClone(hit.d),
      moved: false,
    };
  };

  private capture(e: PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    this.capturing = true;
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.longPress && this.downAt && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 8) {
      clearTimeout(this.longPress);
      this.longPress = null;
    }
    if (this.draft) {
      const pt = this.toPoint(p);
      if (pt) this.draft.hover = pt;
      this.redraw();
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    const logical = this.chart.timeScale().coordinateToLogical(p.x);
    const price = this.series.coordinateToPrice(p.y);
    if (logical === null || price === null) return;
    drag.moved = true;
    const dl = Math.round(logical - drag.startLogical);
    const dp = price - drag.startPrice;
    const moved = structuredClone(drag.orig);
    const data = moved.data;
    const shift = (pt: DrawingPoint): DrawingPoint => ({
      time: this.index.toTime(Math.round(this.index.toLogical(pt.time)) + dl, true),
      price: pt.price + dp,
    });
    if (drag.target === 'body') {
      data.points = data.points.map((pt) =>
        data.kind === 'vline'
          ? { ...shift(pt), price: pt.price }
          : data.kind === 'hline'
            ? { ...pt, price: pt.price + dp }
            : shift(pt),
      );
      if (data.kind === 'position')
        data.target = (drag.orig.data as Extract<DrawingData, { kind: 'position' }>).target + dp;
    } else if (data.kind === 'position' && drag.target === 2) {
      data.target = price;
    } else {
      const i = drag.target;
      const pt = { time: this.index.toTime(logical, true), price };
      if (data.kind === 'hline') data.points[0] = { ...(data.points[0] as DrawingPoint), price };
      else if (data.kind === 'vline')
        data.points[0] = { ...(data.points[0] as DrawingPoint), time: pt.time };
      else data.points[i] = pt;
    }
    this.drawings = this.drawings.map((d) => (d.id === moved.id ? moved : d));
    this.redraw();
  };

  private onUp = () => {
    if (this.longPress) clearTimeout(this.longPress);
    this.longPress = null;
    this.capturing = false;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    const drag = this.drag;
    this.drag = null;
    if (drag?.moved) {
      const d = this.drawings.find((x) => x.id === drag.id);
      if (d) this.cb.commit(d);
    }
  };

  private finishDraft(): void {
    const draft = this.draft;
    if (!draft) return;
    const pts = draft.points;
    let data: DrawingData;
    const p0 = pts[0] as DrawingPoint;
    const p1 = pts[1] as DrawingPoint;
    switch (draft.kind) {
      case 'hline':
      case 'vline':
        data = { kind: draft.kind, points: [p0] };
        break;
      case 'trend':
      case 'ray':
      case 'ruler':
        data = { kind: draft.kind, points: [p0, p1] };
        break;
      case 'zone':
        data = { kind: 'zone', points: [p0, p1], extendRight: true };
        break;
      case 'channel':
        data = { kind: 'channel', points: [p0, p1, pts[2] as DrawingPoint] };
        break;
      case 'fib':
        data = {
          kind: 'fib',
          points: [p0, p1],
          levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618],
        };
        break;
      case 'position': {
        const side = p1.price < p0.price ? 'long' : 'short';
        // o 2º clique define o stop; a largura vem do tempo do 2º clique (mínimo de 10 candles)
        const minEnd = this.index.toTime(Math.round(this.index.toLogical(p0.time)) + 10, true);
        const stopPt = { time: Math.max(p1.time, minEnd), price: p1.price };
        data = {
          kind: 'position',
          side,
          points: [p0, stopPt],
          target: defaultTarget(p0.price, p1.price, 2),
        };
        break;
      }
      case 'text': {
        const text = window.prompt('Texto da nota:')?.trim();
        this.draft = null;
        this.cb.toolDone();
        if (!text) return;
        data = { kind: 'text', points: [p0], text: text.slice(0, 500) };
        break;
      }
    }
    const color = draft.kind === 'zone' ? '#f59e0b' : draft.kind === 'fib' ? '#a78bfa' : '#38bdf8';
    const d: Drawing = {
      id: this.cb.newId(),
      symbolId: this.symbolId,
      tf: null,
      locked: false,
      hidden: false,
      style: { color, lineWidth: 2, dashed: false },
      data,
    };
    this.draft = null;
    this.drawings = [...this.drawings, d];
    this.cb.commit(d);
    // primeiro encerra a ferramenta (que limpa a seleção), depois seleciona o desenho novo
    this.cb.toolDone();
    this.cb.select(d.id);
  }

  // ---------------------------------------------------------------- desenho na tela

  private render(target: Target): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const w = mediaSize.width;
      const h = mediaSize.height;
      ctx.save();
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (const d of this.drawings) {
        if (d.hidden) continue;
        const pts = this.project(d);
        if (pts) this.drawOne(ctx, d, pts, w, h, d.id === this.selectedId);
      }
      if (this.draft) this.drawDraft(ctx, w, h);
      ctx.restore();
    });
  }

  private label(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string,
    align: 'left' | 'right' = 'left',
  ) {
    if (!text) return;
    const pad = 3;
    const tw = ctx.measureText(text).width;
    const maxX = ctx.canvas.width / (window.devicePixelRatio || 1);
    let bx = align === 'right' ? x - tw - pad * 2 : x;
    // mantém o rótulo inteiro dentro da área do gráfico
    bx = Math.max(2, Math.min(bx, maxX - tw - pad * 2 - 2));
    ctx.fillStyle = 'rgba(11,17,32,0.85)';
    ctx.fillRect(bx, y - 8, tw + pad * 2, 16);
    ctx.fillStyle = color;
    ctx.fillText(text, bx + pad, y);
  }

  private fmt(price: number): string {
    return formatNumber(price, this.cb.getMeta()?.priceDecimals ?? 2);
  }

  private drawOne(
    ctx: CanvasRenderingContext2D,
    d: Drawing,
    pts: P[],
    w: number,
    h: number,
    selected: boolean,
  ) {
    const color = d.style.color;
    ctx.strokeStyle = color;
    ctx.lineWidth = d.style.lineWidth + (selected ? 1 : 0);
    ctx.setLineDash(d.style.dashed ? [6, 4] : []);
    const line = (a: P, b: P) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };
    const [a, b, c] = pts as [P, P, P];
    const data = d.data;
    switch (data.kind) {
      case 'hline':
        line({ x: 0, y: a.y }, { x: w, y: a.y });
        this.label(ctx, this.fmt(data.points[0]?.price ?? 0), w - 4, a.y, color, 'right');
        break;
      case 'vline':
        line({ x: a.x, y: 0 }, { x: a.x, y: h });
        break;
      case 'trend':
        line(a, b);
        break;
      case 'ray':
        line(a, extendRay(a, b, w));
        break;
      case 'zone': {
        const x1 = Math.min(a.x, b.x);
        const x2 = data.extendRight ? w : Math.max(a.x, b.x);
        ctx.fillStyle = hexAlpha(color, 0.15);
        ctx.fillRect(x1, Math.min(a.y, b.y), x2 - x1, Math.abs(b.y - a.y));
        ctx.lineWidth = 1;
        line({ x: x1, y: a.y }, { x: x2, y: a.y });
        line({ x: x1, y: b.y }, { x: x2, y: b.y });
        break;
      }
      case 'channel': {
        const off = c.y - lineAt(a, b, c.x);
        const a2 = { x: a.x, y: a.y + off };
        const b2 = { x: b.x, y: b.y + off };
        ctx.fillStyle = hexAlpha(color, 0.08);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.lineTo(a2.x, a2.y);
        ctx.closePath();
        ctx.fill();
        line(a, b);
        line(a2, b2);
        break;
      }
      case 'fib': {
        const p1 = data.points[0]?.price ?? 0;
        const p2 = data.points[1]?.price ?? 0;
        const x1 = Math.min(a.x, b.x);
        ctx.lineWidth = 1;
        for (const lv of data.levels) {
          const price = fibPrice(p1, p2, lv);
          const y = this.y(price);
          if (y === null) continue;
          ctx.strokeStyle = lv === 0.5 || lv === 0.618 ? '#f59e0b' : color;
          line({ x: x1, y }, { x: w, y });
          this.label(
            ctx,
            `${formatNumber(lv * 100, 1)}%  ${this.fmt(price)}`,
            x1 + 2,
            y - 9,
            ctx.strokeStyle as string,
          );
        }
        ctx.strokeStyle = hexAlpha(color, 0.5);
        ctx.setLineDash([3, 3]);
        line(a, b);
        break;
      }
      case 'ruler': {
        const p1 = data.points[0] as DrawingPoint;
        const p2 = data.points[1] as DrawingPoint;
        const up = p2.price >= p1.price;
        ctx.fillStyle = hexAlpha(up ? '#22c55e' : '#ef4444', 0.12);
        ctx.fillRect(
          Math.min(a.x, b.x),
          Math.min(a.y, b.y),
          Math.abs(b.x - a.x),
          Math.abs(b.y - a.y),
        );
        ctx.strokeStyle = up ? '#22c55e' : '#ef4444';
        line(a, b);
        const bars = Math.round(this.index.toLogical(p2.time) - this.index.toLogical(p1.time));
        const pct = p1.price ? ((p2.price - p1.price) / p1.price) * 100 : 0;
        this.label(
          ctx,
          `${up ? '+' : ''}${this.fmt(p2.price - p1.price)} (${up ? '+' : ''}${formatNumber(pct, 2)}%) · ${bars} candles`,
          Math.min(a.x, b.x),
          Math.min(a.y, b.y) - 12,
          ctx.strokeStyle,
        );
        break;
      }
      case 'position':
        this.drawPosition(ctx, data, pts);
        break;
      case 'text': {
        ctx.font = '12px system-ui, sans-serif';
        this.label(ctx, data.text, a.x, a.y, color);
        ctx.font = '11px system-ui, sans-serif';
        break;
      }
    }
    if (selected) {
      ctx.setLineDash([]);
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#0b1120';
        ctx.fill();
        ctx.strokeStyle = d.locked ? '#94a3b8' : '#f8fafc';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  private drawPosition(
    ctx: CanvasRenderingContext2D,
    data: Extract<DrawingData, { kind: 'position' }>,
    pts: P[],
  ) {
    const [e, s, t] = pts as [P, P, P];
    const x1 = Math.min(e.x, s.x);
    const x2 = Math.max(e.x, s.x);
    const entry = data.points[0]?.price ?? 0;
    const stop = data.points[1]?.price ?? 0;
    ctx.fillStyle = 'rgba(34,197,94,0.18)';
    ctx.fillRect(x1, Math.min(e.y, t.y), x2 - x1, Math.abs(t.y - e.y));
    ctx.fillStyle = 'rgba(239,68,68,0.18)';
    ctx.fillRect(x1, Math.min(e.y, s.y), x2 - x1, Math.abs(s.y - e.y));
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(x1, e.y);
    ctx.lineTo(x2, e.y);
    ctx.stroke();

    const meta = this.cb.getMeta();
    const { capital, riskPct } = this.cb.getRisk();
    let qtyText: string;
    try {
      const r = positionSize({
        capital,
        riskPct,
        entry,
        stop,
        target: data.target,
        lotSize: meta?.lotSize ?? 1,
        minQty: meta?.minQty ?? 1,
        qtyStep: meta?.qtyStep ?? 1,
        pointValue: meta?.pointValue ?? 1,
        fractional: meta?.market === 'b3',
      });
      const cur = meta?.currency ?? 'BRL';
      const money = (v: number) => (cur === 'BRL' ? formatBRL(v) : formatMoney(v, cur));
      const qty = formatNumber(r.quantity, r.quantity % 1 === 0 ? 0 : 5);
      const lots =
        meta?.market === 'b3' && r.fractionalQty > 0
          ? ` (${r.standardQty} + ${r.fractionalQty} frac.)`
          : '';
      qtyText =
        r.quantity > 0
          ? `Qtd ${qty}${lots} · risco ${money(r.maxLoss)} · R:R ${r.rr !== null ? formatNumber(r.rr, 2) : '—'}`
          : `Qtd 0: o risco de ${formatNumber(riskPct, 1)}% (${money(r.riskBudget)}) não cobre 1 unidade com esse stop`;
      this.label(
        ctx,
        `Alvo ${this.fmt(data.target)} · ganho ${money(r.gainAtTarget ?? 0)}`,
        x1 + 2,
        t.y + (t.y < e.y ? -10 : 10),
        '#22c55e',
      );
      this.label(
        ctx,
        `Stop ${this.fmt(stop)} · perda ${money(r.maxLoss)}`,
        x1 + 2,
        s.y + (s.y > e.y ? 10 : -10),
        '#ef4444',
      );
    } catch {
      qtyText = 'Ajuste o stop';
    }
    this.label(
      ctx,
      `${data.side === 'long' ? 'Compra' : 'Venda'} ${this.fmt(entry)} · ${qtyText}`,
      x1 + 2,
      e.y,
      '#e2e8f0',
    );
  }

  private drawDraft(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const draft = this.draft;
    if (!draft) return;
    const points = [...draft.points, ...(draft.hover ? [draft.hover] : [])];
    const pts: P[] = [];
    for (const pt of points) {
      const x = this.x(pt.time);
      const y = this.y(pt.price);
      if (x !== null && y !== null) pts.push({ x, y });
    }
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    if (draft.kind === 'hline' && pts[0]) {
      ctx.beginPath();
      ctx.moveTo(0, pts[0].y);
      ctx.lineTo(w, pts[0].y);
      ctx.stroke();
    } else if (draft.kind === 'vline' && pts[0]) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, 0);
      ctx.lineTo(pts[0].x, h);
      ctx.stroke();
    } else if (pts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo((pts[0] as P).x, (pts[0] as P).y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
    }
    const left = DRAWING_POINTS[draft.kind] - draft.points.length;
    this.label(
      ctx,
      left > 0 ? `Toque/clique: faltam ${left} ponto(s) · Esc cancela` : '',
      8,
      h - 14,
      '#38bdf8',
    );
  }
}
