import {
  BUILT_IN_PRESETS,
  indicatorLabel,
  indicatorPresetSchema,
  type IndicatorConfig,
  type IndicatorPreset,
} from '@radar/core';
import { useState } from 'react';
import type { LibrarySlug } from '../library/catalog';
import { usePrefs } from '../lib/prefs';
import { HelpLink } from './HelpLink';

const HELP: Record<IndicatorConfig['kind'], LibrarySlug> = {
  ema: 'medias-moveis',
  sma: 'medias-moveis',
  bollinger: 'bandas-de-bollinger',
  volume: 'volume',
  adx: 'adx',
  atr: 'atr-e-stop-atr',
  stopAtr: 'atr-e-stop-atr',
  macd: 'macd',
  rsi: 'ifr',
  stochastic: 'estocastico',
  vwap: 'vwap',
};

type NumKey = { key: string; label: string; step?: number; min?: number };

/** Parâmetros numéricos editáveis por tipo de indicador. */
function numericFields(cfg: IndicatorConfig): NumKey[] {
  switch (cfg.kind) {
    case 'ema':
    case 'sma':
    case 'atr':
    case 'rsi':
      return [{ key: 'period', label: 'Período', min: 1 }];
    case 'bollinger':
      return [
        { key: 'period', label: 'Período', min: 2 },
        { key: 'stdDev', label: 'Desvios', step: 0.5, min: 0.5 },
      ];
    case 'volume':
      return [{ key: 'maPeriod', label: 'Média do volume', min: 1 }];
    case 'adx':
      return [{ key: 'period', label: 'Período', min: 1 }];
    case 'stopAtr':
      return [
        { key: 'period', label: 'ATR', min: 1 },
        { key: 'defaultMultiplier', label: 'Mult. (diário/intra)', step: 0.5, min: 0.5 },
      ];
    case 'macd':
      return [
        { key: 'fast', label: 'Rápida', min: 1 },
        { key: 'slow', label: 'Lenta', min: 1 },
        { key: 'signal', label: 'Sinal', min: 1 },
      ];
    case 'stochastic':
      return [
        { key: 'period', label: 'Período', min: 1 },
        { key: 'kSmooth', label: '%K', min: 1 },
        { key: 'dPeriod', label: '%D', min: 1 },
      ];
    case 'vwap':
      return [];
  }
}

function slug(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'preset'}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Editor de presets (SPEC §7: "Padrão do canal", "Limpo" e personalizados). */
export function PresetEditor({ preset, onClose }: { preset: IndicatorPreset; onClose(): void }) {
  const { savePreset, deletePreset, setPresetId } = usePrefs();
  const builtIn = BUILT_IN_PRESETS.some((p) => p.id === preset.id);
  const [draft, setDraft] = useState<IndicatorPreset>(() => structuredClone(preset));
  const [err, setErr] = useState<string | null>(null);

  const setInd = (i: number, patch: Partial<IndicatorConfig>) =>
    setDraft((d) => ({
      ...d,
      indicators: d.indicators.map((x, j) =>
        j === i ? ({ ...x, ...patch } as IndicatorConfig) : x,
      ),
    }));

  const save = async (asNew: boolean) => {
    setErr(null);
    let name = draft.name;
    if (asNew) {
      const n = window
        .prompt(
          'Nome do novo preset:',
          builtIn ? `${preset.name} (cópia)` : `${draft.name} (cópia)`,
        )
        ?.trim();
      if (!n) return;
      name = n;
    }
    const next = { ...draft, name, id: asNew ? slug(name) : draft.id, builtIn: false };
    const parsed = indicatorPresetSchema.safeParse(next);
    if (!parsed.success) {
      setErr('Algum parâmetro está inválido (ex.: período zero).');
      return;
    }
    try {
      await savePreset(parsed.data);
      setPresetId(parsed.data.id);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-lg border border-line bg-panel p-3 text-sm sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Editar indicadores"
      >
        <div className="mb-2 flex items-center">
          <h2 className="font-semibold">Indicadores — {preset.name}</h2>
          <button className="ml-auto text-muted" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        {builtIn && (
          <p className="mb-2 rounded bg-panel-2 p-2 text-xs text-muted">
            Preset pronto: não pode ser alterado. Ajuste e salve como um preset novo.
          </p>
        )}
        <ul className="space-y-2">
          {draft.indicators.map((cfg, i) => (
            <li key={cfg.id} className="rounded border border-line/60 p-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  onChange={(e) => setInd(i, { enabled: e.target.checked })}
                />
                <span className="font-medium">{indicatorLabel(cfg)}</span>
                <HelpLink slug={HELP[cfg.kind]} label={`Ajuda: ${indicatorLabel(cfg)}`} />
                {'color' in cfg && (
                  <input
                    type="color"
                    className="ml-auto h-6 w-8 bg-transparent"
                    value={cfg.color.length === 7 ? cfg.color : '#ffffff'}
                    onChange={(e) =>
                      setInd(i, { color: e.target.value } as Partial<IndicatorConfig>)
                    }
                    aria-label={`Cor de ${indicatorLabel(cfg)}`}
                  />
                )}
              </label>
              {cfg.enabled && numericFields(cfg).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2 pl-6">
                  {numericFields(cfg).map((f) => (
                    <label key={f.key} className="flex items-center gap-1 text-xs text-muted">
                      {f.label}
                      <input
                        type="number"
                        inputMode="decimal"
                        step={f.step ?? 1}
                        min={f.min}
                        className="w-16 rounded border border-line bg-bg px-1 py-0.5 text-text"
                        value={(cfg as unknown as Record<string, number>)[f.key]}
                        onChange={(e) =>
                          setInd(i, { [f.key]: Number(e.target.value) } as Partial<IndicatorConfig>)
                        }
                      />
                    </label>
                  ))}
                  {cfg.kind === 'stopAtr' && (
                    <label className="flex items-center gap-1 text-xs text-muted">
                      Mult. semanal/mensal
                      <input
                        type="number"
                        step={0.5}
                        min={0.5}
                        className="w-16 rounded border border-line bg-bg px-1 py-0.5 text-text"
                        value={cfg.multipliers['1w'] ?? cfg.defaultMultiplier}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setInd(i, {
                            multipliers: { ...cfg.multipliers, '1w': v, '1M': v },
                          } as Partial<IndicatorConfig>);
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {err && <p className="mt-2 text-down">{err}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {!builtIn && (
            <button
              className="rounded bg-accent px-3 py-2 font-semibold text-black"
              onClick={() => void save(false)}
            >
              Salvar
            </button>
          )}
          <button
            className="rounded border border-accent px-3 py-2 text-accent"
            onClick={() => void save(true)}
          >
            Salvar como novo
          </button>
          {!builtIn && (
            <button
              className="ml-auto rounded border border-down/60 px-3 py-2 text-down"
              onClick={async () => {
                if (!window.confirm(`Excluir o preset "${preset.name}"?`)) return;
                await deletePreset(preset.id).catch((e: Error) => setErr(e.message));
                onClose();
              }}
            >
              Excluir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
