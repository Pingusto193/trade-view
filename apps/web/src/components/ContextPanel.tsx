import type { ContextItem, ContextReport } from '@radar/core';
import type { Timeframe } from '@radar/shared';
import { TIMEFRAME_LABEL, formatSessionDate } from '@radar/shared';
import { useState } from 'react';
import { analysisKey, useAnalysis } from '../lib/analysis-store';

function Row<T>({
  title,
  item,
  tone,
}: {
  title: string;
  item: ContextItem<T>;
  tone?: 'good' | 'bad' | 'warn' | 'neutral';
}) {
  const [open, setOpen] = useState(false);
  const color =
    tone === 'good'
      ? 'text-up'
      : tone === 'bad'
        ? 'text-down'
        : tone === 'warn'
          ? 'text-warn'
          : 'text-text';
  return (
    <li className="border-b border-line/50 py-1.5">
      <button
        className="flex w-full items-start gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="w-24 shrink-0 text-xs text-muted">{title}</span>
        <span className={`flex-1 text-xs font-medium ${color}`}>{item.label}</span>
        <span className="text-[10px] text-muted">{open ? '▴' : 'por quê?'}</span>
      </button>
      {open && (
        <ul className="ml-24 mt-1 list-disc pl-4 text-[11px] text-muted">
          {item.why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Painel de Contexto (SPEC §9). Cada item mostra o "porquê" ao ser tocado. */
export function ContextPanel({ id, tf }: { id: string; tf: Timeframe }) {
  const a = useAnalysis((s) => s.byKey[analysisKey(id, tf)]);
  const r: ContextReport | null | undefined = a?.context;
  if (!a) return <p className="p-3 text-sm text-muted">Calculando…</p>;
  if (!r)
    return (
      <p className="p-3 text-sm text-muted">
        Poucos candles para avaliar o contexto (mínimo de 30).
      </p>
    );
  const trendTone = r.trend.value === 'alta' ? 'good' : r.trend.value === 'baixa' ? 'bad' : 'warn';
  return (
    <div className="h-full overflow-y-auto p-2 text-sm">
      <p className="mb-1 text-xs text-muted">
        {TIMEFRAME_LABEL[tf]} · último candle fechado em {formatSessionDate(r.time)}
      </p>
      {r.wind.value === 'contra' && (
        <p className="mb-2 rounded border border-down/60 bg-down/15 p-2 text-xs font-semibold text-down">
          ⚠ Aviso vermelho: a escala maior ({a.higherLabel}) está contra. A regra mestra do canal é
          que a escala maior manda.
        </p>
      )}
      <ul>
        <Row title="Tendência" item={r.trend} tone={trendTone} />
        <Row
          title="Força (ADX)"
          item={r.adx}
          tone={
            r.adx.value === 'lateral' ? 'warn' : r.adx.value === 'cinzenta' ? 'neutral' : 'good'
          }
        />
        <Row
          title="Estrutura"
          item={{ ...r.structure, label: `Topos e fundos: ${r.structure.value}` }}
        />
        <Row
          title="Alinhamento"
          item={r.alignment}
          tone={
            r.alignment.value === 'nenhum'
              ? 'neutral'
              : r.alignment.value === 'alta'
                ? 'good'
                : 'bad'
          }
        />
        <Row title="Média respeitada" item={r.respected} />
        <Row title="Inclinações" item={r.slopes} />
        <Row title="Maturidade" item={r.maturity} tone="neutral" />
        <Row
          title="Escala maior"
          item={r.wind}
          tone={r.wind.value === 'contra' ? 'bad' : r.wind.value === 'a-favor' ? 'good' : 'neutral'}
        />
      </ul>
      <p className="mt-2 text-[10px] text-muted">
        Leitura automática, objetiva e reproduzível — não é recomendação. Regras exatas na
        Biblioteca.
      </p>
    </div>
  );
}
