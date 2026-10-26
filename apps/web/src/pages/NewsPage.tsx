import { formatAgo, formatDateTime, formatIn } from '@radar/shared';
import { useEffect, useMemo, useState } from 'react';
import { NewsList } from '../components/NewsList';
import { useNews } from '../lib/news-store';
import { usePrefs } from '../lib/prefs';
import { useWatchlists } from '../lib/watchlists-store';

type Filter = 'meus' | 'win' | 'wdo' | 'tudo';

const min = (ms: number | null) =>
  ms === null ? '—' : ms < 60_000 ? '<1 min' : `${Math.round(ms / 60_000)} min`;

/** Notícias em tempo real (SPEC §23.1): feed filtrado e saúde de cada fonte. */
export default function NewsPage() {
  const [filter, setFilter] = useState<Filter>('meus');
  const lists = useWatchlists((s) => s.lists);
  const loadLists = useWatchlists((s) => s.load);
  const recent = usePrefs((s) => s.recent);
  const { sources, loadSources, agenda, loadAgenda } = useNews();
  useEffect(() => {
    void loadLists();
    void loadSources().catch(() => undefined);
    void loadAgenda().catch(() => undefined);
  }, [loadLists, loadSources, loadAgenda]);

  const mine = useMemo(() => {
    const ids = new Set<string>(['mt5:WIN', 'mt5:WDO']);
    for (const l of lists) for (const i of l.items) ids.add(i);
    for (const r of recent.slice(0, 5)) ids.add(r.id);
    return [...ids].slice(0, 50);
  }, [lists, recent]);
  const symbols =
    filter === 'meus'
      ? mine
      : filter === 'win'
        ? ['mt5:WIN']
        : filter === 'wdo'
          ? ['mt5:WDO']
          : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 text-sm">
      <h1 className="text-xl font-semibold">Notícias</h1>
      <p className="text-xs text-muted">
        Fontes gratuitas e permitidas. Cada título abre a matéria original; o Radar guarda só
        título, link, horário e um trecho curto do feed. A associação a ativos é por palavras e
        códigos (pode errar).
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtro de notícias">
        {(
          [
            ['meus', 'Meus ativos'],
            ['win', 'Mini-índice'],
            ['wdo', 'Mini-dólar'],
            ['tudo', 'Tudo'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1 text-xs ${filter === k ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {agenda && agenda.length > 0 && (
        <section className="rounded border border-line p-3" aria-label="Agenda econômica">
          <h2 className="mb-1 text-sm font-semibold">Agenda</h2>
          <ul className="space-y-1 text-xs">
            {agenda.slice(0, 4).map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="w-32 text-muted">
                  {e.approximate ? '~' : ''}
                  {formatDateTime(e.at)}
                </span>
                <span>{e.country === 'BR' ? '🇧🇷' : '🇺🇸'}</span>
                <a
                  href={e.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent"
                >
                  {e.title}
                </a>
                <span className="text-muted">
                  {e.at > Date.now() ? formatIn(e.at) : formatAgo(e.at)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted">
            Datas oficiais do BCB e do Fed copiadas para o Radar (revisadas por ano). IPCA, payroll
            e CPI entram depois do teste das APIs do IBGE e do BLS.
          </p>
        </section>
      )}
      <section className="rounded border border-line" aria-label="Feed de notícias">
        <NewsList symbols={symbols} />
      </section>
      <details className="rounded border border-line p-3">
        <summary className="cursor-pointer font-semibold">Fontes e atraso medido</summary>
        <p className="mt-2 text-xs text-muted">
          Atraso = hora em que chegou ao Radar − hora de publicação informada pela fonte, só das
          notícias que apareceram depois que o Radar começou a ler (o acervo inicial fica de fora).
          Inclui o intervalo de consulta do Radar.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs" data-testid="news-sources">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 pr-2">Fonte</th>
                <th className="pr-2">Situação</th>
                <th className="pr-2">24 h</th>
                <th className="pr-2">Atraso (mediana / p90, n)</th>
              </tr>
            </thead>
            <tbody>
              {(sources ?? []).map((s) => (
                <tr key={s.id} className="border-t border-line align-top">
                  <td className="py-1 pr-2">
                    <b>{s.label}</b>
                    <div className="text-muted">{s.terms}</div>
                  </td>
                  <td className="pr-2">
                    {!s.enabled ? (
                      <span className="text-warn">desligada: {s.disabledReason}</span>
                    ) : s.lastError ? (
                      <span className="text-down">erro: {s.lastError}</span>
                    ) : s.lastOkAt ? (
                      <span className="text-up">ok {formatAgo(s.lastOkAt)}</span>
                    ) : (
                      <span className="text-muted">aguardando 1ª leitura</span>
                    )}
                  </td>
                  <td className="pr-2">{s.items24h}</td>
                  <td className="pr-2">
                    {min(s.delay.medianMs)} / {min(s.delay.p90Ms)} (n={s.delay.n})
                  </td>
                </tr>
              ))}
              {sources?.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-muted">
                    Nenhuma fonte configurada neste servidor.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
