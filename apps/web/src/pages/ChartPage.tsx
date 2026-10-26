import { BUILT_IN_PRESETS, SIMPLE_PRESET } from '@radar/core';
import type { Timeframe } from '@radar/shared';
import { FRACTAL_MAPPINGS, TIMEFRAMES, TIMEFRAME_LABEL, timeframeSchema } from '@radar/shared';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChartView } from '../chart/ChartView';
import { FractalView } from '../chart/FractalView';
import { DrawingList, DrawingPanel } from '../chart/drawings/DrawingPanel';
import { DrawingToolbar, TOOL_SHORTCUTS } from '../chart/drawings/DrawingToolbar';
import { useTicket } from '../components/OrderTicket';
import { useAlertForm } from '../lib/alerts-store';
import { useDrawings, useDrawingTool } from '../lib/drawings-store';
import { PresetEditor } from '../components/PresetEditor';
import { SymbolSearch } from '../components/SymbolSearch';
import { ContextPanel } from '../components/ContextPanel';
import { EventStudyBox } from '../components/EventStudyBox';
import { PredictPanel } from '../components/PredictPanel';
import { ReadingCard } from '../components/ReadingCard';
import { NewsList } from '../components/NewsList';
import { analysisKey, useAnalysis } from '../lib/analysis-store';
import { HelpLink } from '../components/HelpLink';
import { SetupsPanel } from '../components/SetupsPanel';
import { WatchlistPanel } from '../components/WatchlistPanel';
import { usePrefs, usePreset, type ChartType } from '../lib/prefs';

const DEFAULT_ID = 'binance:BTCUSDT';

const SHORT: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '60m': '60m',
  '1d': 'D',
  '1w': 'S',
  '1M': 'M',
};

/**
 * Tela do gráfico. O estado fica na URL (?id=&tf=&modo=3) para que alertas e links abram o gráfico
 * "no estado certo" (SPEC §10).
 */
export function ChartPage() {
  const [params, setParams] = useSearchParams();
  const prefs = usePrefs();
  const preset = usePreset();
  const id = params.get('id') ?? prefs.recent[0]?.id ?? DEFAULT_ID;
  const tfParsed = timeframeSchema.safeParse(params.get('tf'));
  const tf: Timeframe = tfParsed.success ? tfParsed.data : (prefs.recent[0]?.tf ?? '1d');
  const simple = prefs.view === 'simples';
  const fractal = !simple && params.get('modo') === '3';
  const mapping = FRACTAL_MAPPINGS.find((m) => m.id === prefs.fractalId) ?? FRACTAL_MAPPINGS[0]!;

  const [drawMode, setDrawMode] = useState(false);
  const [showList, setShowList] = useState(false);
  const [editPreset, setEditPreset] = useState(false);
  type Side = 'lista' | 'setups' | 'contexto' | 'noticias' | 'previsao';
  const SIDE_LABEL: Record<Side, string> = {
    lista: 'Lista',
    setups: 'Setups',
    contexto: 'Contexto',
    noticias: 'Notícias',
    previsao: 'Previsão',
  };
  const [side, setSide] = useState<Side | null>(() =>
    window.innerWidth >= 1200 ? 'setups' : null,
  );
  const toggleSide = (s: Side) => setSide((cur) => (cur === s ? null : s));

  // Atalhos de teclado (computador): Esc, Delete e Alt + letra da ferramenta.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return;
      const tool = useDrawingTool.getState();
      if (e.key === 'Escape') {
        tool.setTool(null);
        tool.select(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && tool.selectedId) {
        const d = (useDrawings.getState().bySymbol[id] ?? []).find((x) => x.id === tool.selectedId);
        if (d && !d.locked) {
          useDrawings.getState().remove(d);
          tool.select(null);
        }
      } else if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const kind = TOOL_SHORTCUTS[e.code.replace('Key', '')];
        if (kind) {
          e.preventDefault();
          setDrawMode(true);
          tool.setTool(kind);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);

  useEffect(() => {
    useDrawingTool.getState().select(null);
  }, [id]);

  useEffect(() => {
    prefs.pushRecent(id, tf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tf]);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={`no-scrollbar flex items-center gap-2 border-b border-line px-2 py-1.5 ${simple ? 'flex-wrap' : 'overflow-x-auto'}`}
      >
        <SymbolSearch current={id} onPick={(next) => set({ id: next })} />
        {!fractal && (
          <div
            className={`flex rounded border border-line ${simple ? 'order-last w-full justify-between sm:order-none sm:w-auto sm:justify-start' : ''}`}
            role="group"
            aria-label="Escala"
          >
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                type="button"
                title={TIMEFRAME_LABEL[t]}
                onClick={() => set({ tf: t })}
                className={`px-2 py-1 text-xs ${t === tf ? 'bg-accent/20 font-semibold text-accent' : 'text-muted hover:text-text'}`}
              >
                {SHORT[t]}
              </button>
            ))}
          </div>
        )}
        <div
          className="flex shrink-0 overflow-hidden rounded-full border border-line text-xs"
          role="group"
          aria-label="Modo do gráfico"
        >
          {(
            [
              ['simples', 'Simples'],
              ['completo', 'Completo'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => prefs.setView(v)}
              aria-pressed={prefs.view === v}
              className={`px-3 py-1 ${prefs.view === v ? 'bg-accent font-semibold text-black' : 'text-muted hover:text-text'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {!simple && (
          <>
            <button
              type="button"
              onClick={() => set({ modo: fractal ? null : '3' })}
              className={`whitespace-nowrap rounded border px-2 py-1 text-xs ${fractal ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
              title="Modo 3 escalas: contexto, setup e gatilho"
            >
              3 escalas
            </button>
            {fractal && (
              <select
                value={mapping.id}
                onChange={(e) => prefs.setFractalId(e.target.value)}
                className="rounded border border-line bg-panel px-1 py-1 text-xs"
                aria-label="Mapeamento das 3 escalas"
              >
                {FRACTAL_MAPPINGS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({TIMEFRAME_LABEL[m.context]} + {TIMEFRAME_LABEL[m.setup]} +{' '}
                    {TIMEFRAME_LABEL[m.trigger]})
                  </option>
                ))}
              </select>
            )}
            {fractal && <HelpLink slug="visao-fractal" label="Ajuda: visão fractal (3 escalas)" />}
            <button
              type="button"
              onClick={() => {
                setDrawMode((m) => !m);
                useDrawingTool.getState().setTool(null);
              }}
              aria-pressed={drawMode}
              className={`whitespace-nowrap rounded border px-2 py-1 text-xs ${drawMode ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
              title="Ferramentas de desenho"
            >
              ✏️ Desenhar
            </button>
            <button
              type="button"
              onClick={() => setShowList((v) => !v)}
              className="whitespace-nowrap rounded border border-line px-2 py-1 text-xs text-muted"
              title="Lista de desenhos (reexibir ocultos)"
            >
              ☰ Desenhos
            </button>
            <select
              value={prefs.chartType}
              onChange={(e) => prefs.setChartType(e.target.value as ChartType)}
              className="rounded border border-line bg-panel px-1 py-1 text-xs"
              aria-label="Tipo de gráfico"
            >
              <option value="candles">Candles</option>
              <option value="heikin">Heikin-Ashi</option>
              <option value="line">Linha</option>
            </select>
            <select
              value={preset.id}
              onChange={(e) => prefs.setPresetId(e.target.value)}
              className="rounded border border-line bg-panel px-1 py-1 text-xs"
              aria-label="Preset de indicadores"
            >
              {[...BUILT_IN_PRESETS, ...prefs.customPresets].map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setEditPreset(true)}
              className="rounded border border-line px-2 py-1 text-xs text-muted"
              title="Editar indicadores"
              aria-label="Editar indicadores"
            >
              ⚙
            </button>
          </>
        )}
        {prefs.mode === 'treino' && (
          <button
            type="button"
            onClick={() => useTicket.getState().open(id, fractal ? mapping.setup : tf)}
            className="whitespace-nowrap rounded border border-train/70 bg-train/15 px-2 py-1 text-xs font-semibold text-train"
            title="Comprar com dinheiro fictício (preço real)"
          >
            🎯<span className={simple ? 'sr-only sm:not-sr-only' : ''}> Treino</span>
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            useAlertForm.getState().open({ symbolId: id, tf: fractal ? mapping.setup : tf })
          }
          className="rounded border border-line px-2 py-1 text-xs text-muted"
          title="Criar alerta para este ativo"
          aria-label="Criar alerta"
        >
          🔔
        </button>
        <button
          type="button"
          onClick={() => toggleSide('noticias')}
          className={`whitespace-nowrap rounded border px-2 py-1 text-xs ${side === 'noticias' ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
          aria-pressed={side === 'noticias'}
          aria-label="Notícias deste ativo"
          title="Notícias deste ativo"
        >
          📰<span className={simple ? 'sr-only sm:not-sr-only' : ''}> Notícias</span>
        </button>
        {!fractal && (
          <button
            type="button"
            onClick={() => toggleSide('previsao')}
            className={`whitespace-nowrap rounded border px-2 py-1 text-xs ${side === 'previsao' ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
            aria-pressed={side === 'previsao'}
            aria-label="Previsão deste ativo"
            title="Previsão honesta (probabilidade com histórico de acerto)"
          >
            📊<span className={simple ? 'sr-only sm:not-sr-only' : ''}> Previsão</span>
          </button>
        )}
        {!simple &&
          (
            [
              ['setups', '◎ Setups'],
              ['contexto', '🧭 Contexto'],
              ['lista', '☆ Lista'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => toggleSide(k)}
              className={`whitespace-nowrap rounded border px-2 py-1 text-xs ${side === k ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'} ${k === 'lista' ? 'hidden lg:block' : ''}`}
              aria-pressed={side === k}
            >
              {label}
            </button>
          ))}
      </div>
      {simple && <ReadingCard id={id} tf={tf} />}
      {drawMode && !simple && <DrawingToolbar />}
      {!simple && prefs.chartType === 'heikin' && (
        <p className="border-b border-line bg-panel px-2 py-1 text-xs text-warn">
          Heikin-Ashi é só visual: os preços mostrados não são negociáveis. Indicadores e setups
          usam os candles reais.{' '}
          <HelpLink slug="heikin-ashi" label="Ajuda: Heikin-Ashi" className="align-middle" />
        </p>
      )}
      {editPreset && <PresetEditor preset={preset} onClose={() => setEditPreset(false)} />}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <DrawingPanel symbolId={id} tf={fractal ? mapping.setup : tf} />
          {showList && <DrawingList symbolId={id} onClose={() => setShowList(false)} />}
          {fractal ? (
            <FractalView
              id={id}
              mapping={mapping}
              preset={preset}
              chartType={prefs.chartType}
              upColor={prefs.upColor}
              downColor={prefs.downColor}
            />
          ) : (
            <ChartView
              id={id}
              tf={tf}
              preset={simple ? SIMPLE_PRESET : preset}
              chartType={simple ? 'candles' : prefs.chartType}
              upColor={prefs.upColor}
              downColor={prefs.downColor}
              simple={simple}
            />
          )}
        </div>
        {side && (!simple || side === 'noticias' || side === 'previsao') && (
          <aside
            className="fixed inset-x-0 bottom-0 z-30 h-[60vh] rounded-t-xl border-t border-line bg-panel shadow-2xl lg:static lg:z-auto lg:h-auto lg:w-80 lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none"
            aria-label={SIDE_LABEL[side]}
          >
            <div className="flex items-center border-b border-line px-2 py-1 text-xs lg:hidden">
              <b>{SIDE_LABEL[side]}</b>
              <button
                className="ml-auto px-2 text-muted"
                onClick={() => setSide(null)}
                aria-label="Fechar painel"
              >
                ✕
              </button>
            </div>
            <div className="h-[calc(100%-1.75rem)] lg:h-full">
              {side === 'lista' && <WatchlistPanel compact />}
              {side === 'setups' && <SetupsPanel id={id} tf={fractal ? mapping.setup : tf} />}
              {side === 'contexto' && <ContextPanel id={id} tf={fractal ? mapping.setup : tf} />}
              {side === 'previsao' && !fractal && <PredictPanel id={id} tf={tf} />}
              {side === 'noticias' && (
                <div className="h-full overflow-y-auto">
                  <NewsList
                    symbols={[id]}
                    compact
                    onPick={(n) =>
                      useAnalysis
                        .getState()
                        .focusTimeOn(
                          analysisKey(id, fractal ? mapping.setup : tf),
                          n.publishedAt ?? n.arrivedAt,
                        )
                    }
                  />
                  {!fractal && <EventStudyBox id={id} tf={tf} />}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
