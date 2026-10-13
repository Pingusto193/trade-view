import type { SkippedIndicator } from '@radar/core';
import type { SymbolMeta, Timeframe } from '@radar/shared';
import { formatNumber, formatVolume } from '@radar/shared';
import { useState } from 'react';
import type { HoverInfo } from './controller';
import { chartTimeLabel, toChartTime } from './time';

/**
 * Legenda no canto do gráfico: OHLC, variação, volume e valores dos indicadores no cursor.
 * `skipped`: indicadores ligados que não valem nesta escala (ex.: VWAP no diário) — aviso curto.
 */
export function Legend({
  hover,
  meta,
  tf,
  skipped = [],
}: {
  hover: HoverInfo | null;
  meta: SymbolMeta | null;
  tf: Timeframe;
  skipped?: readonly SkippedIndicator[];
}) {
  // Em telas pequenas os valores dos indicadores começam recolhidos.
  const [showValues, setShowValues] = useState(() => window.innerWidth >= 640);
  if (!hover?.candle || !meta) return null;
  const c = hover.candle;
  const d = meta.priceDecimals;
  const ch = c.open ? (c.close / c.open - 1) * 100 : 0;
  const up = c.close >= c.open;
  return (
    <div className="pointer-events-none absolute left-2 right-20 top-1 z-10 text-[11px] leading-tight">
      <div className="flex flex-wrap gap-x-2 rounded bg-bg/70 px-1">
        <span className="text-muted" data-testid="legend-time">
          {chartTimeLabel(toChartTime(c.time, tf), tf)}
        </span>
        <span>
          A <b>{formatNumber(c.open, d)}</b>
        </span>
        <span>
          M <b>{formatNumber(c.high, d)}</b>
        </span>
        <span>
          m <b>{formatNumber(c.low, d)}</b>
        </span>
        <span>
          F <b className={up ? 'text-up' : 'text-down'}>{formatNumber(c.close, d)}</b>
        </span>
        <span className={up ? 'text-up' : 'text-down'}>
          {ch >= 0 ? '+' : ''}
          {formatNumber(ch, 2)}%
        </span>
        {meta.volume !== 'none' && <span className="text-muted">Vol {formatVolume(c.volume)}</span>}
        <button
          type="button"
          className="pointer-events-auto text-muted underline"
          onClick={() => setShowValues((v) => !v)}
          aria-expanded={showValues}
        >
          {showValues ? 'ocultar valores' : 'indicadores'}
        </button>
      </div>
      <div
        className={`mt-0.5 flex-wrap gap-x-2 rounded bg-bg/70 px-1 ${showValues ? 'flex' : 'hidden'}`}
      >
        {hover.values.map((v) => (
          <span key={v.label} style={{ color: v.color === '#ffffff' ? '#f8fafc' : v.color }}>
            {v.label}{' '}
            {v.pane === 'volume'
              ? formatVolume(v.value)
              : formatNumber(v.value, v.pane === 'price' || v.pane === 'atr' ? d : 1)}
          </span>
        ))}
      </div>
      {/* fora do bloco recolhível: no celular a linha de valores começa fechada */}
      {skipped.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-x-2 rounded bg-bg/70 px-1">
          {skipped.map((s) => (
            <span key={s.id} className="text-warn" data-testid="legend-skipped">
              ⚠ {s.reason}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
