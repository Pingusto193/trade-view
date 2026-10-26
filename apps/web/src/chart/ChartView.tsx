import type { IndicatorPreset } from '@radar/core';
import { marketState, MARKET_STATE_LABEL, skippedIndicators } from '@radar/core';
import type { Candle, FeedStatus, SymbolMeta, Timeframe } from '@radar/shared';
import { TIMEFRAME_LABEL } from '@radar/shared';
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { analysisKey, useAnalysis, useSetupView } from '../lib/analysis-store';
import { newDrawingId, useDrawings, useDrawingTool } from '../lib/drawings-store';
import { usePaper } from '../lib/paper-store';
import { usePrefs, type ChartType } from '../lib/prefs';
import { ChartController, type HoverInfo, type PaperLine } from './controller';
import { Legend } from './Legend';
import { registerChart } from './registry';
import { LiveSeries, type LiveSeriesEvents } from './live-series';
import { SourceBadge } from './SourceBadge';
import { indicatorWorker } from './worker-client';
import { feedKey, useNews } from '../lib/news-store';

export interface ChartHandle {
  syncCrosshair(timeMs: number | null, sourceTf: Timeframe): void;
}

/** Fonte de candles do gráfico: a ao vivo (padrão) ou outra, como o replay. */
export interface SeriesSource {
  readonly candles: Candle[];
  start(): Promise<void>;
  dispose(): void;
}

export interface ChartViewProps {
  id: string;
  tf: Timeframe;
  preset: IndicatorPreset;
  chartType: ChartType;
  upColor: string;
  downColor: string;
  /** Rótulo do papel no modo 3 escalas (Contexto / Setup / Gatilho). */
  role?: string;
  visibleBars?: number;
  onCrosshairTime?(timeMs: number | null, tf: Timeframe): void;
  ref?: Ref<ChartHandle>;
  /** Outra fonte de candles (replay). Precisa ser estável (useCallback): trocar recria o gráfico. */
  source?: (ev: LiveSeriesEvents) => SeriesSource;
  /** Chave dos desenhos (padrão: o ativo). O replay usa a sua, para não misturar com o gráfico real. */
  drawingKey?: string;
  /** Linhas de posição/ordens vindas de fora (replay); sem isto, usa as do Modo Treino. */
  paperLines?: PaperLine[];
  /** Esconde datas e horários (replay sorteado). */
  hideTime?: boolean;
  /** Faixa extra no cabeçalho (ex.: "REPLAY"). */
  banner?: ReactNode;
  /** Não desenha marcações de setups (exercícios: seriam a resposta). */
  hideSetups?: boolean;
  /** Modo simples (ADR-0029): setas discretas, sem linhas de gatilho/stop/alvo dos setups. */
  simple?: boolean;
}

let seq = 0;

export function ChartView(props: ChartViewProps) {
  const {
    id,
    tf,
    preset,
    chartType,
    upColor,
    downColor,
    role,
    visibleBars = 150,
    onCrosshairTime,
    ref,
    source,
    drawingKey = id,
    paperLines: externalLines,
    hideTime = false,
    banner,
    hideSetups = false,
    simple = false,
  } = props;
  const externalRef = useRef(externalLines);
  externalRef.current = externalLines;
  const box = useRef<HTMLDivElement>(null);
  const ctl = useRef<ChartController | null>(null);
  const crossCb = useRef(onCrosshairTime);
  crossCb.current = onCrosshairTime;
  const [meta, setMeta] = useState<SymbolMeta | null>(null);
  const [status, setStatus] = useState<FeedStatus>({ state: 'connecting' });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const metaRef = useRef<SymbolMeta | null>(null);
  metaRef.current = meta;

  useImperativeHandle(ref, () => ({
    syncCrosshair: (t, src) => ctl.current?.syncCrosshair(t, src),
  }));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setMeta(null);
    setError(null);
    setEmpty(false);
    setStatus({ state: 'connecting' });
    const key = `chart-${++seq}`;
    let raf = 0;
    const controller = new ChartController(el, preset, {
      tf,
      chartType,
      upColor,
      downColor,
      hideTime,
      onHover: (h) => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => setHover(h));
      },
      onCrosshairTime: (t, src) => crossCb.current?.(t, src),
      drawing: {
        symbolId: drawingKey,
        callbacks: {
          commit: (d) => useDrawings.getState().save(d),
          select: (sel) => useDrawingTool.getState().select(sel),
          toolDone: () => useDrawingTool.getState().setTool(null),
          context: (sel) => useDrawingTool.getState().select(sel),
          getMeta: () => metaRef.current,
          getRisk: () => {
            const p = usePrefs.getState();
            return { capital: p.capital, riskPct: p.riskPct };
          },
          newId: newDrawingId,
        },
      },
    });
    ctl.current = controller;

    // desenhos do ativo: carrega do servidor e acompanha mudanças (inclusive de outros aparelhos)
    const dm = controller.drawings;
    void useDrawings.getState().load(drawingKey);
    const applyDrawings = () => dm?.setDrawings(useDrawings.getState().bySymbol[drawingKey] ?? []);
    applyDrawings();
    const unsubDrawings = useDrawings.subscribe((st, prev) => {
      if (st.bySymbol[drawingKey] !== prev.bySymbol[drawingKey]) applyDrawings();
    });
    const applyTool = () => {
      const t = useDrawingTool.getState();
      dm?.setTool(t.tool);
      dm?.setSelected(t.selectedId);
    };
    applyTool();
    const unsubTool = useDrawingTool.subscribe(applyTool);

    const aKey = analysisKey(id, tf);
    const applyView = () => {
      const a = useAnalysis.getState().byKey[aKey];
      const v = useSetupView.getState();
      if (!a || hideSetups) return;
      controller.setSetupMarkers(a.events, v.hidden, v.showRadar, simple);
      controller.setOpenSetups(simple ? [] : a.open, v.hidden);
    };
    const unsubView = useSetupView.subscribe(applyView);

    // Modo Treino: posição e ordens deste ativo no gráfico
    const applyPaper = () => {
      if (externalRef.current) {
        controller.setPaperLines(externalRef.current);
        return;
      }
      const st = usePaper.getState().state;
      const lines: PaperLine[] = [];
      if (st && usePrefs.getState().mode === 'treino') {
        for (const p of st.positions.filter((x) => x.symbolId === id)) {
          lines.push({ price: p.avgPrice, title: `Treino ${p.qty}`, kind: 'entry' });
          if (p.stop !== null) lines.push({ price: p.stop, title: 'Stop treino', kind: 'stop' });
          if (p.target !== null)
            lines.push({ price: p.target, title: 'Alvo treino', kind: 'target' });
        }
        for (const o of st.orders.filter((x) => x.symbolId === id && x.price !== null)) {
          lines.push({
            price: o.price as number,
            title: `${o.side === 'buy' ? 'Compra' : 'Venda'} ${o.type === 'limit' ? 'lim.' : 'stop'} treino`,
            kind: 'order',
          });
        }
      }
      controller.setPaperLines(lines);
    };
    const unsubPaper = usePaper.subscribe(applyPaper);
    const unregister = registerChart(`${id}|${tf}`, () => controller.chart.takeScreenshot());
    if (usePrefs.getState().mode === 'treino' && !usePaper.getState().loaded) {
      void usePaper
        .getState()
        .load()
        .catch(() => undefined);
    }
    const unsubFocus = useAnalysis.subscribe((st, prev) => {
      if (st.focus && st.focus !== prev.focus && st.focus.key === aKey) {
        controller.focusIndex(st.focus.index);
      }
      if (st.focusAt && st.focusAt !== prev.focusAt && st.focusAt.key === aKey) {
        controller.focusTime(st.focusAt.time);
      }
    });
    // marcadores de notícia (SPEC §23.1) — nunca no replay/exercícios (entregariam a data e o ativo)
    const showNews = !source && !hideTime;
    const nKey = feedKey([id]);
    const applyNews = () => {
      const f = useNews.getState().feeds[nKey];
      controller.setNewsMarkers(
        showNews ? (f?.items ?? []).map((n) => n.publishedAt ?? n.arrivedAt) : [],
      );
    };
    if (showNews) void useNews.getState().load([id]);
    const unsubNews = showNews ? useNews.subscribe(applyNews) : () => undefined;
    // previsão (SPEC §23.2): o worker só calcula enquanto algum painel pedir
    const wanted = () => (useAnalysis.getState().predictWanted[aKey] ?? 0) > 0;
    let predictOn = false;
    const syncPredict = () => {
      if (wanted() === predictOn) return;
      predictOn = wanted();
      indicatorWorker.post({ type: 'predict', key, on: predictOn });
    };
    const unsubPredict = useAnalysis.subscribe((st, prev) => {
      if (st.predictWanted !== prev.predictWanted) syncPredict();
    });
    const stopWorker = indicatorWorker.listen(key, (msg) => {
      if (msg.type === 'prediction') {
        useAnalysis.getState().setPrediction(aKey, msg.report);
        return;
      }
      if (msg.type === 'analysis') {
        useAnalysis.getState().apply(aKey, msg, msg.reset);
        applyView();
        return;
      }
      if (msg.type === 'full') controller.setIndicators(msg.outputs);
      else controller.applyTail(msg.time, msg.tail);
      // sem cursor sobre um candle antigo, a legenda acompanha o último (inclusive quando o minuto vira)
      setHover((h) =>
        controller.isHovering() && h && h.time !== series.candles.at(-1)?.time
          ? h
          : controller.lastHover(),
      );
    });

    const events: LiveSeriesEvents = {
      onReset: (candles, m, lastOpen) => {
        setMeta(m);
        setEmpty(candles.length === 0);
        controller.setData(candles, m, visibleBars);
        setHover(controller.lastHover());
        applyPaper();
        indicatorWorker.post({
          type: 'reset',
          key,
          tf,
          tz: m.session.timezone,
          tick: m.tickSize,
          preset,
          candles,
          lastOpen,
          setupParams: usePrefs.getState().setupParams ?? {},
          money: {
            tick: m.tickSize,
            pointValue: m.pointValue,
            minQty: m.minQty,
            qtyStep: m.qtyStep,
            market: m.market,
          },
        });
        // o worker esquece o pedido de previsão quando ainda não conhecia o gráfico
        predictOn = false;
        syncPredict();
      },
      onUpdate: (candle, closed) => {
        controller.update(candle);
        indicatorWorker.post({ type: 'update', key, candle, closed });
      },
      onStatus: setStatus,
      onError: setError,
    };
    const series = source ? source(events) : new LiveSeries(id, tf, events);
    void series.start();

    return () => {
      unregister();
      unsubPaper();
      unsubView();
      unsubFocus();
      unsubNews();
      unsubPredict();
      unsubDrawings();
      unsubTool();
      cancelAnimationFrame(raf);
      series.dispose();
      stopWorker();
      controller.dispose();
      ctl.current = null;
    };
  }, [
    id,
    tf,
    preset,
    chartType,
    upColor,
    downColor,
    visibleBars,
    source,
    drawingKey,
    hideTime,
    hideSetups,
    simple,
  ]);

  // linhas do replay mudam sem recriar o gráfico
  useEffect(() => {
    if (externalLines) ctl.current?.setPaperLines(externalLines);
  }, [externalLines]);

  const state = meta && !source ? marketState(meta.session, Date.now()) : null;
  const skipped = useMemo(() => skippedIndicators(preset, tf), [preset, tf]);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line/60 px-2 py-1 text-xs">
        {role && (
          <span className="rounded bg-panel-2 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-accent">
            {role}
          </span>
        )}
        <span className="font-semibold">{meta?.symbol ?? id.split(':')[1]}</span>
        <span className="text-muted">{TIMEFRAME_LABEL[tf]}</span>
        {state && (
          <span
            className={`rounded px-1.5 py-0.5 ${state === 'open' ? 'bg-up/15 text-up' : state === 'pre-open' ? 'bg-warn/15 text-warn' : 'bg-panel-2 text-muted'}`}
          >
            {MARKET_STATE_LABEL[state]}
          </span>
        )}
        <SourceBadge meta={meta} status={status} />
        {banner}
      </div>
      {meta?.delay.kind === 'simulated' && (
        <div className="bg-warn px-2 py-0.5 text-center text-xs font-bold tracking-widest text-black">
          DADOS SIMULADOS — não representam nenhum mercado real
        </div>
      )}
      {/* isolate: os z-index internos do Lightweight Charts (alça entre painéis = 50) ficam presos
          aqui dentro e nunca passam por cima de diálogos e painéis do app */}
      <div className="relative isolate min-h-0 flex-1">
        <div ref={box} className="absolute inset-0" data-testid="chart-canvas" />
        <Legend hover={hover} meta={meta} tf={tf} skipped={skipped} hideTime={hideTime} />
        {error && (
          <div className="absolute inset-x-2 top-12 rounded border border-down/50 bg-panel/95 p-3 text-sm">
            <p className="font-semibold text-down">Não foi possível carregar os dados</p>
            <p className="mt-1 text-muted">{error}</p>
          </div>
        )}
        {!error && empty && (
          <div className="absolute inset-x-2 top-12 rounded border border-warn/50 bg-panel/95 p-3 text-sm">
            <p className="font-semibold text-warn">Sem candles para mostrar</p>
            <p className="mt-1 text-muted">
              {status.message ?? 'A fonte não devolveu dados para esta escala.'} Nenhum dado é
              inventado: quando a fonte volta, o gráfico aparece.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
