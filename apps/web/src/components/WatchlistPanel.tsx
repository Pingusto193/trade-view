import { MARKET_LABEL, delayLabel, formatNumber } from '@radar/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWatchlists } from '../lib/watchlists-store';
import { SymbolSearch } from './SymbolSearch';

/**
 * Listas de observação (SPEC §7). Os selos de setups detectados entram na Fase 3.
 * Tocar num ativo abre o gráfico.
 */
export function WatchlistPanel({ compact = false }: { compact?: boolean }) {
  const {
    lists,
    activeId,
    quotes,
    loaded,
    load,
    setActive,
    update,
    create,
    remove,
    refreshQuotes,
  } = useWatchlists();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const list = lists.find((l) => l.id === activeId) ?? null;

  useEffect(() => {
    if (!loaded) load().catch((e: Error) => setErr(e.message));
  }, [loaded, load]);

  const items = list?.items ?? [];
  const key = items.join(',');
  useEffect(() => {
    if (!key) return;
    const ids = key.split(',');
    const run = () => refreshQuotes(ids).catch(() => undefined);
    void run();
    const t = setInterval(run, 60_000);
    return () => clearInterval(t);
  }, [key, refreshQuotes]);

  const act = (p: Promise<unknown>) => p.catch((e: Error) => setErr(e.message));
  const move = (i: number, d: -1 | 1) => {
    if (!list) return;
    const next = [...list.items];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    void act(update({ ...list, items: next }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <div className="flex items-center gap-1 border-b border-line p-2">
        <select
          className="min-w-0 flex-1 rounded border border-line bg-panel px-1 py-1"
          value={activeId ?? ''}
          onChange={(e) => setActive(Number(e.target.value))}
          aria-label="Lista"
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.items.length})
            </option>
          ))}
        </select>
        {list && (
          <SymbolSearch
            current="+ Ativo"
            label="+ Ativo"
            onPick={(id) =>
              void act(update({ ...list, items: [...list.items.filter((x) => x !== id), id] }))
            }
          />
        )}
        <button
          className={`rounded border px-2 py-1 text-xs ${editing ? 'border-accent text-accent' : 'border-line text-muted'}`}
          onClick={() => setEditing((v) => !v)}
          aria-pressed={editing}
        >
          Editar
        </button>
      </div>
      {err && <p className="px-2 py-1 text-xs text-down">{err}</p>}
      {editing && list && (
        <div className="flex flex-wrap gap-1 border-b border-line p-2 text-xs">
          <button
            className="rounded border border-line px-2 py-1"
            onClick={() => {
              const name = window.prompt('Nome da lista:', list.name)?.trim();
              if (name) void act(update({ ...list, name }));
            }}
          >
            Renomear
          </button>
          <button
            className="rounded border border-line px-2 py-1"
            onClick={() => {
              const name = window.prompt('Nome da nova lista:')?.trim();
              if (name) void act(create(name));
            }}
          >
            Nova lista
          </button>
          <button
            className="rounded border border-down/60 px-2 py-1 text-down"
            onClick={() => {
              if (window.confirm(`Apagar a lista "${list.name}"? Os ativos não são afetados.`)) {
                void act(remove(list.id));
              }
            }}
          >
            Apagar lista
          </button>
        </div>
      )}
      <ul className="min-h-0 flex-1 divide-y divide-line/60 overflow-y-auto">
        {!loaded && <li className="p-3 text-muted">Carregando…</li>}
        {loaded && items.length === 0 && (
          <li className="p-3 text-muted">Lista vazia. Toque em "+ Ativo" para adicionar.</li>
        )}
        {items.map((id, i) => {
          const q = quotes[id];
          const ch = q?.changePct;
          return (
            <li key={id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-panel-2">
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => navigate(`/grafico?id=${encodeURIComponent(id)}&tf=1d`)}
              >
                <span className="w-20 shrink-0 font-semibold">{q?.symbol ?? id.split(':')[1]}</span>
                {!compact && (
                  <span className="hidden min-w-0 flex-1 truncate text-xs text-muted sm:block">
                    {q?.name} {q?.market ? `· ${MARKET_LABEL[q.market]}` : ''}
                  </span>
                )}
                <span className="ml-auto text-right tabular-nums">
                  {q?.error ? (
                    <span className="text-xs text-down" title={q.error}>
                      erro
                    </span>
                  ) : q?.last != null ? (
                    <>
                      {formatNumber(q.last, q.priceDecimals ?? 2)}
                      <span
                        className={`ml-2 text-xs ${ch != null && ch >= 0 ? 'text-up' : 'text-down'}`}
                      >
                        {ch != null ? `${ch >= 0 ? '+' : ''}${formatNumber(ch, 2)}%` : ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted">
                      {q?.status?.message ? 'sem dados' : '…'}
                    </span>
                  )}
                </span>
              </button>
              {q?.delay && q.delay.kind !== 'realtime' && !compact && (
                <span className="hidden text-[10px] text-muted lg:inline">
                  {delayLabel(q.delay)}
                </span>
              )}
              {editing && list && (
                <span className="flex gap-1">
                  <button
                    className="rounded border border-line px-1"
                    onClick={() => move(i, -1)}
                    aria-label="Subir"
                  >
                    ↑
                  </button>
                  <button
                    className="rounded border border-line px-1"
                    onClick={() => move(i, 1)}
                    aria-label="Descer"
                  >
                    ↓
                  </button>
                  <button
                    className="rounded border border-down/50 px-1 text-down"
                    onClick={() =>
                      void act(update({ ...list, items: list.items.filter((x) => x !== id) }))
                    }
                    aria-label={`Remover ${id}`}
                  >
                    ✕
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-2 py-1 text-[10px] text-muted">
        Variação contra o fechamento diário anterior. Selos de setups chegam na Fase 3.
      </p>
    </div>
  );
}
