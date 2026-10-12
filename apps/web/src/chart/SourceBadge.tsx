import type { FeedStatus, SymbolMeta } from '@radar/shared';
import {
  FEED_STATE_LABEL,
  VOLUME_QUALITY_LABEL,
  delayLabel,
  formatAgo,
  formatDateTime,
} from '@radar/shared';
import { useState } from 'react';

/**
 * Selo de transparência da fonte (SPEC §3.2): fonte, atraso, qualidade do volume e estado.
 * Tocar abre os detalhes (notas da fonte, último dado válido).
 */
export function SourceBadge({ meta, status }: { meta: SymbolMeta | null; status: FeedStatus }) {
  const [open, setOpen] = useState(false);
  const bad =
    status.state !== 'ok' && status.state !== 'connecting' && status.state !== 'market-closed';
  const dot =
    status.state === 'ok'
      ? 'bg-up'
      : status.state === 'connecting' || status.state === 'market-closed'
        ? 'bg-warn'
        : 'bg-down';
  return (
    <span className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded border px-1.5 py-0.5 ${bad ? 'border-down/60 text-down' : 'border-line text-muted'}`}
        aria-label="Detalhes da fonte de dados"
      >
        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
        {meta ? (
          <>
            <span>{meta.sourceLabel}</span>
            <span>· {delayLabel(meta.delay)}</span>
            <span className="hidden sm:inline">· {VOLUME_QUALITY_LABEL[meta.liveVolume]}</span>
          </>
        ) : (
          <span>{FEED_STATE_LABEL[status.state]}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-30 w-72 rounded border border-line bg-panel p-3 text-xs shadow-xl">
          <p>
            <b>Estado:</b> {FEED_STATE_LABEL[status.state]}
          </p>
          {status.message && <p className="mt-1 text-muted">{status.message}</p>}
          {status.lastValidAt && (
            <p className="mt-1">
              <b>Último dado válido:</b> {formatDateTime(status.lastValidAt)} (
              {formatAgo(status.lastValidAt)})
            </p>
          )}
          {meta && (
            <>
              <p className="mt-2">
                <b>Fonte:</b> {meta.sourceLabel} — {delayLabel(meta.delay)}
              </p>
              <p>
                <b>Volume histórico:</b> {VOLUME_QUALITY_LABEL[meta.volume]}
              </p>
              <p>
                <b>Volume ao vivo:</b> {VOLUME_QUALITY_LABEL[meta.liveVolume]}
              </p>
              <p>
                <b>Ajuste por proventos:</b>{' '}
                {meta.adjusted === 'yes'
                  ? 'sim'
                  : meta.adjusted === 'no'
                    ? 'NÃO ajustado'
                    : 'desconhecido'}
              </p>
              {meta.notes.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-muted">
                  {meta.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
