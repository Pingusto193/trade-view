import {
  DISTORTION_FILTERS,
  SCAN_SCHEDULES,
  SCAN_SCHEDULE_LABEL,
  TIMEFRAMES,
  TIMEFRAME_LABEL,
  formatDateTime,
  type ScanFilters,
  type ScanSchedule,
  type ScanUniverse,
  type Timeframe,
} from '@radar/shared';
import { useEffect, useState } from 'react';
import { HelpLink } from '../components/HelpLink';
import { ScanFiltersForm, countFilters } from '../components/ScanFiltersForm';
import { ScanResults } from '../components/ScanResults';
import { getSources } from '../lib/api';
import { useScanner } from '../lib/scanner-store';

const input = 'rounded border border-line bg-panel px-2 py-1 text-sm';
const uniKey = (u: ScanUniverse) => `${u.kind}:${u.id}`;
function parseUni(k: string): ScanUniverse {
  const [kind, id] = k.split(':');
  return kind === 'watchlist'
    ? { kind: 'watchlist', id: Number(id) }
    : { kind: 'suggested', id: id as Extract<ScanUniverse, { kind: 'suggested' }>['id'] };
}

/** Scanner multi-mercado (SPEC §14): onde há setup e contexto agora, nas suas listas e conjuntos. */
export function ScannerPage() {
  const s = useScanner();
  const [simulated, setSimulated] = useState(false);
  const [uni, setUni] = useState<string>('');
  const [tf, setTf] = useState<Timeframe>('1d');
  const [filters, setFilters] = useState<ScanFilters>({});
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState<ScanSchedule>('off');

  useEffect(() => {
    if (!s.loaded) void s.init();
    void getSources()
      .then((x) => setSimulated(x.simulated))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // universo padrão: primeira lista do usuário; sem lista, o conjunto sugerido (simulado em dev)
  useEffect(() => {
    if (uni || !s.universes) return;
    const w = s.universes.watchlists[0];
    setUni(w ? `watchlist:${w.id}` : `suggested:${simulated ? 'sim' : 'b3'}`);
  }, [s.universes, simulated, uni]);

  const running = Boolean(s.snapshot?.running);
  const universe = uni ? parseUni(uni) : null;
  const openSaved = (id: string) => {
    const sc = s.saved.find((x) => x.id === id);
    if (!sc) return;
    setUni(uniKey(sc.config.universe));
    setTf(sc.config.tf);
    setFilters(sc.config.filters);
    setName(sc.name);
    setSchedule(sc.schedule);
    void s.show({ kind: 'saved', id });
  };
  const currentSaved = s.view.kind === 'saved' ? s.view.id : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3">
      <h1 className="text-xl font-semibold">
        Scanner <HelpLink slug="painel-contexto" label="Ajuda: o que cada coluna significa" />
      </h1>
      <p className="text-sm text-muted">
        Procura setups e contexto nos ativos das suas listas ou nos conjuntos sugeridos, com o mesmo
        detector do gráfico e só candles fechados. <b>Não é recomendação</b>: antes de usar um
        setup, veja a amostra e o resultado depois de custos no Laboratório.
      </p>

      <section
        className="space-y-2 rounded border border-line p-3"
        aria-label="Configurar varredura"
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs text-muted">Ativos</span>
            <select
              className={input}
              value={uni}
              onChange={(e) => setUni(e.target.value)}
              aria-label="Ativos"
            >
              {s.universes?.watchlists.length ? (
                <optgroup label="Suas listas">
                  {s.universes.watchlists.map((w) => (
                    <option key={w.id} value={`watchlist:${w.id}`}>
                      {w.name} ({w.count})
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Sugeridos">
                {s.universes?.suggested
                  .filter((x) => x.id !== 'sim' || simulated)
                  .map((x) => (
                    <option key={x.id} value={`suggested:${x.id}`}>
                      {x.label}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted">Tempo gráfico</span>
            <select
              className={input}
              value={tf}
              onChange={(e) => setTf(e.target.value as Timeframe)}
              aria-label="Tempo gráfico"
            >
              {TIMEFRAMES.map((t) => (
                <option key={t} value={t}>
                  {TIMEFRAME_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded border border-accent px-2 py-1 text-sm text-accent"
            onClick={() => setFilters(DISTORTION_FILTERS)}
            title="MME21 e MMA50 semanais descendo, queda de 50% ou mais e LPA crescendo (fundamentos)"
          >
            Filtro pronto: Distorção (reflexividade)
          </button>
          {countFilters(filters) > 0 && (
            <button
              type="button"
              className="rounded border border-line px-2 py-1 text-sm text-muted"
              onClick={() => setFilters({})}
            >
              Limpar filtros ({countFilters(filters)})
            </button>
          )}
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-muted">
            Filtros ({countFilters(filters)})
          </summary>
          <div className="mt-2">
            <ScanFiltersForm value={filters} onChange={setFilters} />
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!universe || running}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
            onClick={() => universe && void s.run({ universe, tf, filters })}
          >
            {running ? 'Varrendo…' : 'Varrer agora'}
          </button>
          {s.universes && (
            <span className="text-xs text-muted">
              Até {s.universes.limits.maxSymbols} ativos por varredura (
              {s.universes.limits.maxIntraday} no intradiário), um por vez, respeitando os limites
              das fontes.
            </span>
          )}
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Salvar esta varredura e agendar</summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="block text-xs text-muted">Nome</span>
              <input
                className={input}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                aria-label="Nome da varredura"
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted">Agenda</span>
              <select
                className={input}
                value={schedule}
                onChange={(e) => setSchedule(e.target.value as ScanSchedule)}
                aria-label="Agenda"
              >
                {SCAN_SCHEDULES.map((x) => (
                  <option key={x} value={x}>
                    {SCAN_SCHEDULE_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!universe || !name.trim()}
              className="rounded border border-line px-3 py-1 text-sm disabled:opacity-50"
              onClick={async () => {
                if (!universe) return;
                const saved = await s.save(
                  { name: name.trim(), universe, tf, filters, schedule },
                  currentSaved,
                );
                if (saved) void s.show({ kind: 'saved', id: saved.id });
              }}
            >
              {currentSaved ? 'Atualizar varredura salva' : 'Salvar'}
            </button>
          </div>
        </details>
      </section>

      {s.error && (
        <p role="alert" className="rounded border border-down p-2 text-sm text-down">
          {s.error}
        </p>
      )}

      {s.saved.length > 0 && (
        <section className="rounded border border-line p-3" aria-label="Varreduras salvas">
          <h2 className="mb-1 text-sm font-semibold">Varreduras salvas</h2>
          <ul className="divide-y divide-line/50 text-sm">
            {s.saved.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <button
                  type="button"
                  className={`text-left ${currentSaved === x.id ? 'text-accent' : ''}`}
                  onClick={() => openSaved(x.id)}
                >
                  <span className="block font-medium">{x.name}</span>
                  <span className="block text-xs text-muted">
                    {SCAN_SCHEDULE_LABEL[x.schedule]} ·{' '}
                    {x.summary.running
                      ? 'rodando…'
                      : x.summary.updatedAt
                        ? `${x.summary.pass} passaram de ${x.summary.rows} · ${formatDateTime(x.summary.updatedAt)}`
                        : 'ainda não rodou'}
                    {x.summary.errors > 0 && ` · ${x.summary.errors} com erro`}
                  </span>
                </button>
                <span className="ml-auto flex gap-1">
                  <button
                    type="button"
                    className="rounded border border-line px-2 py-0.5 text-xs"
                    disabled={running}
                    onClick={() => void s.runSaved(x.id)}
                  >
                    Rodar
                  </button>
                  <button
                    type="button"
                    className="rounded border border-line px-2 py-0.5 text-xs text-muted"
                    onClick={() => {
                      if (confirm(`Apagar a varredura "${x.name}"?`)) void s.remove(x.id);
                    }}
                  >
                    Apagar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.snapshot && (
        <section className="space-y-2" aria-label="Resultado" data-testid="scan-result">
          <p className="text-xs text-muted">
            {s.snapshot.universeLabel} · {TIMEFRAME_LABEL[s.snapshot.config.tf]}
            {s.snapshot.running
              ? ` · varrendo ${s.snapshot.running.done} de ${s.snapshot.running.total}${
                  s.snapshot.running.current ? ` (${s.snapshot.running.current})` : ''
                }…`
              : s.snapshot.lastRun
                ? ` · ${formatDateTime(s.snapshot.lastRun.finishedAt)}`
                : ''}
            {s.snapshot.truncated > 0 &&
              ` · ${s.snapshot.truncated} ativos ficaram de fora pelo limite`}
          </p>
          {s.snapshot.lastRun?.status === 'error' && (
            <p className="text-sm text-down">✕ {s.snapshot.lastRun.error}</p>
          )}
          <ScanResults snapshot={s.snapshot} filters={filters} />
        </section>
      )}
    </div>
  );
}
