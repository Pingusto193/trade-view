import type { IndicatorPreset } from '@radar/core';
import type { FractalMapping, Timeframe } from '@radar/shared';
import { TIMEFRAME_LABEL } from '@radar/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChartType } from '../lib/prefs';
import { ChartView, type ChartHandle } from './ChartView';

const ROLES = ['Contexto', 'Setup', 'Gatilho'] as const;

function useIsWide(): boolean {
  const q = '(min-width: 900px)';
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const fn = () => setWide(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  return wide;
}

/**
 * Modo 3 escalas ("visão fractal", SPEC §7): três gráficos do mesmo ativo com cursor sincronizado.
 * No celular viram abas deslizáveis.
 */
export function FractalView(props: {
  id: string;
  mapping: FractalMapping;
  preset: IndicatorPreset;
  chartType: ChartType;
  upColor: string;
  downColor: string;
}) {
  const { mapping } = props;
  const tfs: Timeframe[] = [mapping.context, mapping.setup, mapping.trigger];
  const refs = [useRef<ChartHandle>(null), useRef<ChartHandle>(null), useRef<ChartHandle>(null)];
  const wide = useIsWide();
  const [tab, setTab] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);

  const onCross = useCallback(
    (from: number) => (t: number | null, tf: Timeframe) => {
      refs.forEach((r, i) => {
        if (i !== from) r.current?.syncCrosshair(t, tf);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const goTab = (i: number) => {
    setTab(i);
    const el = scroller.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  const charts = tfs.map((tf, i) => (
    <div
      key={`${tf}-${i}`}
      className={
        wide
          ? 'min-h-0 min-w-0 flex-1 border-r border-line/60 last:border-r-0'
          : 'snap-start h-full w-full shrink-0'
      }
    >
      <ChartView
        ref={refs[i]}
        id={props.id}
        tf={tf}
        role={ROLES[i]}
        preset={props.preset}
        chartType={props.chartType}
        upColor={props.upColor}
        downColor={props.downColor}
        visibleBars={wide ? 90 : 70}
        onCrosshairTime={onCross(i)}
      />
    </div>
  ));

  if (wide) return <div className="flex h-full min-h-0">{charts}</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex border-b border-line text-sm" role="tablist">
        {tfs.map((tf, i) => (
          <button
            key={tf + i}
            type="button"
            role="tab"
            aria-selected={tab === i}
            onClick={() => goTab(i)}
            className={`flex-1 px-2 py-2 ${tab === i ? 'border-b-2 border-accent font-semibold text-accent' : 'text-muted'}`}
          >
            {ROLES[i]} · {TIMEFRAME_LABEL[tf]}
          </button>
        ))}
      </div>
      <div
        ref={scroller}
        className="no-scrollbar snap-x-mandatory flex min-h-0 flex-1 overflow-x-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (i !== tab) setTab(i);
        }}
      >
        {charts}
      </div>
    </div>
  );
}
