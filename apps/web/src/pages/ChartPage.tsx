import { BUILT_IN_PRESETS } from '@radar/core';
import type { Timeframe } from '@radar/shared';
import { FRACTAL_MAPPINGS, TIMEFRAMES, TIMEFRAME_LABEL, timeframeSchema } from '@radar/shared';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChartView } from '../chart/ChartView';
import { FractalView } from '../chart/FractalView';
import { SymbolSearch } from '../components/SymbolSearch';
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
  const fractal = params.get('modo') === '3';
  const mapping = FRACTAL_MAPPINGS.find((m) => m.id === prefs.fractalId) ?? FRACTAL_MAPPINGS[0]!;

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
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto border-b border-line px-2 py-1.5">
        <SymbolSearch current={id} onPick={(next) => set({ id: next })} />
        {!fractal && (
          <div className="flex rounded border border-line" role="group" aria-label="Escala">
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
      </div>
      {prefs.chartType === 'heikin' && (
        <p className="border-b border-line bg-panel px-2 py-1 text-xs text-warn">
          Heikin-Ashi é só visual: os preços mostrados não são negociáveis. Indicadores e setups
          usam os candles reais.
        </p>
      )}
      <div className="min-h-0 flex-1">
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
            preset={preset}
            chartType={prefs.chartType}
            upColor={prefs.upColor}
            downColor={prefs.downColor}
          />
        )}
      </div>
    </div>
  );
}
