import { EXIT_LABEL, SETUP_LABEL, STATE_LABEL, type SetupEvent, type SetupId } from '@radar/core';
import {
  formatNumber,
  formatSessionDate,
  isIntraday,
  formatDateTime,
  type Timeframe,
} from '@radar/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { libraryPath, type LibrarySlug } from '../library/catalog';
import { useAlertForm } from '../lib/alerts-store';
import { analysisKey, useAnalysis, useSetupView } from '../lib/analysis-store';
import { HelpLink } from './HelpLink';

export const SETUP_HELP: Record<SetupId, LibrarySlug> = {
  s91: 'setup-9-1',
  s92: 'setup-9-2',
  s93: 'setup-9-3',
  pullback: 'recuo-a-media',
  consolidation: 'rompimento-consolidacao',
  elastic: 'elastico',
  reflexivity: 'reflexividade',
};

const ALL: SetupId[] = ['s91', 's92', 's93', 'pullback', 'consolidation', 'elastic', 'reflexivity'];

const STATE_COLOR: Record<SetupEvent['state'], string> = {
  radar: 'text-muted',
  armado: 'text-accent',
  acionado: 'text-up',
  encerrado: 'text-text',
};

function when(time: number, tf: Timeframe) {
  return isIntraday(tf) ? formatDateTime(time) : formatSessionDate(time);
}

function EventRow({
  e,
  tf,
  onFocus,
  decimals,
}: {
  e: SetupEvent;
  tf: Timeframe;
  onFocus(): void;
  decimals: number;
}) {
  const [open, setOpen] = useState(false);
  const f = (n: number | null | undefined) =>
    n === null || n === undefined ? '—' : formatNumber(n, decimals);
  return (
    <li className="border-b border-line/50 py-1.5">
      <button
        className="flex w-full items-start gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`w-16 shrink-0 text-xs font-semibold ${STATE_COLOR[e.state]}`}>
          {STATE_LABEL[e.state]}
          {e.exit ? (
            <span className="block font-normal text-muted">{EXIT_LABEL[e.exit]}</span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs">
            <b>{SETUP_LABEL[e.setup]}</b> {e.side === 'sell' ? '(venda)' : ''} · {when(e.time, tf)}
            {e.resultR !== undefined && (
              <b className={`ml-1 ${e.resultR >= 0 ? 'text-up' : 'text-down'}`}>
                {e.resultR >= 0 ? '+' : ''}
                {formatNumber(e.resultR, 2)}R
              </b>
            )}
          </span>
          <span className="block text-xs text-muted">{e.reason}</span>
        </span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 rounded bg-bg p-2 text-[11px]">
          <p>
            Gatilho {f(e.trigger)} · Stop {f(e.stop)} · Alvo{' '}
            {e.target === null ? 'dinâmico' : f(e.target)}
            {e.entry !== undefined ? ` · Entrada ${f(e.entry)}` : ''}
          </p>
          {e.score !== undefined && <p>Pontuação do recuo: {e.score}</p>}
          {e.notes?.map((n) => (
            <p key={n} className={n.startsWith('⚠') ? 'text-warn' : 'text-muted'}>
              • {n}
            </p>
          ))}
          <details>
            <summary className="cursor-pointer text-muted">Parâmetros usados</summary>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-muted">
              {JSON.stringify(e.params, null, 1)}
            </pre>
          </details>
          <div className="flex items-center gap-3">
            <button
              className="rounded border border-accent px-2 py-0.5 text-accent"
              onClick={onFocus}
            >
              Ver no gráfico
            </button>
            <Link to={libraryPath(SETUP_HELP[e.setup])} className="text-accent underline">
              Regras do setup
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

/** Painel de setups do ativo/escala: ocorrências abertas, histórico e filtros de exibição. */
export function SetupsPanel({
  id,
  tf,
  decimals = 2,
}: {
  id: string;
  tf: Timeframe;
  decimals?: number;
}) {
  const key = analysisKey(id, tf);
  const a = useAnalysis((s) => s.byKey[key]);
  const focusOn = useAnalysis((s) => s.focusOn);
  const view = useSetupView();
  const [filter, setFilter] = useState<'abertos' | 'todos'>('abertos');

  const recent = useMemo(() => {
    const evs = (a?.events ?? []).filter(
      (e) => !view.hidden.includes(e.setup) && (view.showRadar || e.state !== 'radar'),
    );
    return evs.slice(-150).reverse();
  }, [a, view.hidden, view.showRadar]);

  const openIds = new Set((a?.open ?? []).map((o) => o.id));
  const shown = filter === 'abertos' ? recent.filter((e) => openIds.has(e.id)) : recent;
  // mostra só o evento mais recente de cada ocorrência aberta
  const dedup =
    filter === 'abertos'
      ? shown.filter((e, i) => shown.findIndex((x) => x.id === e.id) === i)
      : shown;

  const stats = useMemo(() => {
    const closed = (a?.events ?? []).filter(
      (e) => e.state === 'encerrado' && e.resultR !== undefined,
    );
    const n = closed.length;
    const wins = closed.filter((e) => (e.resultR ?? 0) > 0).length;
    const avg = n ? closed.reduce((s, e) => s + (e.resultR ?? 0), 0) / n : 0;
    return { n, wins, avg };
  }, [a]);

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <div className="space-y-1 border-b border-line p-2">
        <div className="flex flex-wrap gap-1">
          {ALL.map((s) => (
            <button
              key={s}
              onClick={() => view.toggle(s)}
              aria-pressed={!view.hidden.includes(s)}
              className={`rounded border px-1.5 py-0.5 text-[11px] ${view.hidden.includes(s) ? 'border-line text-muted line-through' : 'border-accent/60 text-text'}`}
            >
              {SETUP_LABEL[s].replace('Setup ', '')}
            </button>
          ))}
          <button
            className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted"
            title="Avisar quando um setup armar ou acionar neste ativo"
            onClick={() =>
              useAlertForm.getState().open({
                symbolId: id,
                tf,
                condition: {
                  kind: 'setup',
                  setups: ALL.filter((s) => !view.hidden.includes(s)),
                  states: ['armado', 'acionado'],
                  sides: ['buy'],
                },
                trigger: 'close',
              })
            }
          >
            🔔 Avisar
          </button>
          <label className="ml-auto flex items-center gap-1 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={view.showRadar}
              onChange={(e) => view.setShowRadar(e.target.checked)}
            />{' '}
            radar
          </label>
        </div>
        <div className="flex gap-1 text-xs">
          {(['abertos', 'todos'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 ${filter === f ? 'bg-panel-2 text-text' : 'text-muted'}`}
            >
              {f === 'abertos' ? `Em andamento (${a?.open.length ?? 0})` : 'Histórico'}
            </button>
          ))}
        </div>
      </div>
      {!a && <p className="p-3 text-muted">Calculando…</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto px-2">
        {a && dedup.length === 0 && (
          <li className="py-3 text-xs text-muted">
            Nenhum setup {filter === 'abertos' ? 'em andamento' : 'no período carregado'}.
          </li>
        )}
        {dedup.map((e) => (
          <EventRow
            key={`${e.id}:${e.index}:${e.state}:${e.price}`}
            e={e}
            tf={tf}
            decimals={decimals}
            onFocus={() => focusOn(key, e.index)}
          />
        ))}
      </ul>
      <p className="border-t border-line p-2 text-[10px] leading-snug text-muted">
        Ocorrências no período carregado: {stats.n} encerradas com entrada, {stats.wins} positivas,
        média {formatNumber(stats.avg, 2)}R. <b>Sem custos e sem IR</b>, amostra pequena: isto NÃO é
        backtest (o laboratório chega na Fase 6).{' '}
        <HelpLink slug="r-multiplo" label="Ajuda: o que é R" className="align-middle" />
      </p>
    </div>
  );
}
