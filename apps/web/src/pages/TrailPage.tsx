import { TRAIL } from '@radar/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { libraryPath, type LibrarySlug } from '../library/catalog';
import { getPage } from '../library/pages';
import { api } from '../lib/api';
import type { TrailProgress } from '../lib/learn-types';
import { usePrefs } from '../lib/prefs';

const card = 'rounded border border-line bg-panel p-3';

function Bar({ done, need }: { done: number; need: number }) {
  const pct = Math.min(100, Math.round((done / Math.max(1, need)) * 100));
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-1.5 w-16 overflow-hidden rounded bg-bg"
        role="progressbar"
        aria-valuenow={Math.min(done, need)}
        aria-valuemax={need}
      >
        <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
      {Math.min(done, need)}/{need}
    </span>
  );
}

/** Trilha de aprendizado (SPEC §13): leitura → exercícios → missão de replay, módulo a módulo. */
export default function TrailPage() {
  const read = usePrefs((s) => s.trailRead);
  const setRead = usePrefs((s) => s.setTrailRead);
  const [p, setP] = useState<TrailProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<TrailProgress>('/api/trail')
      .then((r) => alive && setP(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [read]);
  const toggle = (slug: string, on: boolean) =>
    setRead(on ? [...new Set([...read, slug])] : read.filter((s) => s !== slug));
  const done = p?.modules.filter((m) => m.complete).length ?? 0;
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3">
      <h1 className="text-lg font-semibold">Trilha de aprendizado</h1>
      <p className="text-xs text-muted">
        Ler, exercitar e praticar no replay, nessa ordem. As metas são nossas, para dar ritmo:
        cumprir a trilha não prova que você está pronto para dinheiro real (isso é o Painel de
        prontidão, com números).
      </p>
      {p && (
        <p className="text-sm" data-testid="trail-summary">
          {done} de {TRAIL.length} módulos completos
        </p>
      )}
      {error && <p className="text-sm text-down">Progresso indisponível: {error}</p>}
      <ol className="space-y-2">
        {TRAIL.map((m, i) => {
          const pr = p?.modules.find((x) => x.id === m.id);
          const exParams = m.exercises
            ? `?nivel=${m.exercises.level}${m.exercises.setups ? `&setups=${m.exercises.setups.join(',')}` : ''}&modulo=${m.id}`
            : '';
          return (
            <li key={m.id} className={card} data-testid={`trail-${m.id}`}>
              <div className="flex flex-wrap items-baseline gap-2">
                <b>
                  {i + 1}. {m.title}
                </b>
                {pr?.complete && <span className="text-xs text-up">✓ completo</span>}
              </div>
              <p className="text-xs text-muted">{m.desc}</p>
              <div className="mt-2 space-y-1 text-xs">
                <p className="font-medium">Ler</p>
                <ul className="space-y-0.5">
                  {m.read.map((slug) => (
                    <li key={slug} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={`Marcar como lida: ${getPage(slug)?.meta.titulo ?? slug}`}
                        checked={read.includes(slug)}
                        onChange={(e) => toggle(slug, e.target.checked)}
                      />
                      <Link to={libraryPath(slug as LibrarySlug)} className="text-accent underline">
                        {getPage(slug)?.meta.titulo ?? slug}
                      </Link>
                    </li>
                  ))}
                </ul>
                {m.exercises && (
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Exercícios</span>
                    <span className="text-muted">
                      acerte {m.exercises.perfect} por completo (nível {m.exercises.level})
                    </span>
                    {pr?.exercises && <Bar {...pr.exercises} />}
                    <Link to={`/exercicios${exParams}`} className="text-accent underline">
                      praticar
                    </Link>
                  </p>
                )}
                {m.replay && (
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Missão de replay</span>
                    <span className="text-muted">
                      {m.replay.trades} trades com plano completo
                      {m.replay.setups ? ' deste setup' : ''}
                    </span>
                    {pr?.replay && <Bar {...pr.replay} />}
                    <Link to="/replay" className="text-accent underline">
                      replay
                    </Link>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
