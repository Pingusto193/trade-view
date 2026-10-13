import type { FeedbackStatus, TradeFeedback } from '@radar/core';
import { TIMEFRAME_LABEL, formatNumber } from '@radar/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type FeedbackBody = TradeFeedback & { source: string | null };

/** Ícone + palavra (nunca só cor). */
const STATUS: Record<FeedbackStatus, { icon: string; cls: string; text: string }> = {
  ok: { icon: '✓', cls: 'text-up', text: 'ok' },
  atencao: { icon: '⚠', cls: 'text-warn', text: 'atenção' },
  'sem-dados': { icon: '?', cls: 'text-muted', text: 'sem dados' },
};

const fmtR = (v: number | null) =>
  v === null ? '—' : `${v >= 0 ? '+' : ''}${formatNumber(v, 2)}R`;

/**
 * Feedback depois do trade de treino (SPEC §13): o servidor confere o trade com os candles reais e o
 * mesmo detector do gráfico; aqui só mostramos os itens e o R real × o R do setup "puro".
 */
export function TradeFeedbackPanel({
  positionId,
  realR,
}: {
  positionId: string;
  realR: number | null;
}) {
  const [fb, setFb] = useState<FeedbackBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<FeedbackBody>(`/api/paper/positions/${encodeURIComponent(positionId)}/feedback`)
      .then((b) => {
        if (alive) setFb(b);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [positionId]);

  return (
    <section
      className="mt-1 w-full space-y-2 rounded border border-line bg-bg p-2"
      aria-label="Feedback do trade"
    >
      {!fb && !error && (
        <p className="text-xs text-muted">Conferindo o trade com os candles reais…</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-down">
          Não foi possível montar o feedback: {error}
        </p>
      )}
      {fb && (
        <>
          <div className="grid grid-cols-2 gap-2" data-testid="feedback-compare">
            <div className="rounded bg-panel p-2">
              <p className="text-[11px] text-muted">Seu trade (com custos)</p>
              <p className="font-semibold">{fmtR(fb.pure?.realR ?? realR)}</p>
            </div>
            <div className="rounded bg-panel p-2">
              <p className="text-[11px] text-muted">
                Setup puro{fb.pure ? ` · ${fb.pure.label}` : ''} (sem custos)
              </p>
              <p className="font-semibold">
                {!fb.pure
                  ? '—'
                  : fb.pure.state === 'aberto'
                    ? 'em andamento'
                    : fmtR(fb.pure.setupR)}
              </p>
            </div>
          </div>
          <ul className="space-y-2">
            {fb.items.map((it) => {
              const s = STATUS[it.status];
              return (
                <li
                  key={it.key}
                  className="flex gap-2"
                  data-testid={`feedback-${it.key}`}
                  data-status={it.status}
                >
                  <span
                    aria-hidden="true"
                    className={`w-4 shrink-0 text-center font-bold ${s.cls}`}
                  >
                    {s.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {it.titulo} <span className={`text-xs font-semibold ${s.cls}`}>{s.text}</span>
                    </p>
                    <p className="break-words text-xs text-muted">{it.detalhe}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted">
            Candles: {fb.source ?? 'fonte indisponível'}, escala {TIMEFRAME_LABEL[fb.tf]}.
            Conferência automática por regras fixas do Radar: aponta desvios do plano, não promete
            resultado.
          </p>
        </>
      )}
    </section>
  );
}
