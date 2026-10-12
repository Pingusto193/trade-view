import type { SymbolSearchResult } from '@radar/shared';
import { MARKET_LABEL } from '@radar/shared';
import { useEffect, useRef, useState } from 'react';
import { searchSymbols } from '../lib/api';

/** Busca unificada de ativos entre mercados (SPEC §7). */
export function SymbolSearch({
  onPick,
  current,
  label,
}: {
  onPick(id: string): void;
  current: string;
  /** Texto do botão (padrão: código do ativo atual). */
  label?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      searchSymbols(q)
        .then((r) => alive && setResults(r.results))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setLoading(false));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open]);

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-1 rounded border border-line bg-panel px-2 py-1 text-sm font-semibold hover:border-accent"
        onClick={() => {
          setOpen(true);
          setTimeout(() => input.current?.focus(), 0);
        }}
        aria-label={label ? 'Adicionar ativo' : 'Buscar ativo'}
      >
        {!label && <span aria-hidden>🔎</span>}
        <span>{label ?? current.split(':')[1] ?? current}</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 p-3 sm:p-10"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-line bg-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && results[0]) {
                  onPick(results[0].id);
                  setOpen(false);
                }
              }}
              placeholder="Buscar: BTC, PETR4, AAPL…"
              className="w-full rounded-t-lg border-b border-line bg-transparent px-3 py-3 text-base outline-none"
              aria-label="Texto da busca"
            />
            <ul className="max-h-[60vh] overflow-y-auto">
              {loading && results.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">Buscando…</li>
              )}
              {!loading && results.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">
                  Nenhum ativo encontrado nas fontes configuradas.
                </li>
              )}
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel-2"
                    onClick={() => {
                      onPick(r.id);
                      setOpen(false);
                    }}
                  >
                    <span className="w-20 font-semibold">{r.symbol}</span>
                    <span className="flex-1 truncate text-sm text-muted">{r.name}</span>
                    <span className="rounded bg-panel-2 px-1.5 text-xs">
                      {MARKET_LABEL[r.market]}
                    </span>
                    <span className="text-xs text-muted">{r.sourceLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
