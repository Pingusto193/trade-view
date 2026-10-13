import { SETUP_LABEL, type QuestionKey, type SetupId } from '@radar/core';
import type { Candle, SymbolMeta } from '@radar/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChartView, type SeriesSource } from '../chart/ChartView';
import type { LiveSeriesEvents } from '../chart/live-series';
import { HelpLink } from '../components/HelpLink';
import { api } from '../lib/api';
import type { ExerciseResult, ExerciseView } from '../lib/learn-types';
import { usePrefs, usePreset } from '../lib/prefs';

const card = 'rounded border border-line bg-panel p-3';
const primary =
  'rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50';

/** Candles fixos (exercício): o gráfico de sempre, sem dados ao vivo. */
class StaticSource implements SeriesSource {
  constructor(
    readonly candles: Candle[],
    private readonly meta: SymbolMeta,
    private readonly ev: LiveSeriesEvents,
  ) {}
  async start() {
    this.ev.onStatus({ state: 'ok' });
    this.ev.onReset(this.candles, this.meta, false);
  }
  dispose() {}
}

const LEVEL_TEXT: Record<1 | 2 | 3, string> = {
  1: 'Nível 1: tem setup? qual?',
  2: 'Nível 2: + gatilho e stop',
  3: 'Nível 3: + escala maior',
};

/** Exercícios de leitura (SPEC §13): situações reais do passado, gabarito dos detectores. */
export function ExercisesPage() {
  const [params] = useSearchParams();
  const lvl = Number(params.get('nivel'));
  const [level, setLevel] = useState<1 | 2 | 3>(lvl === 2 || lvl === 3 ? lvl : 1);
  const focus = params.get('setups')?.split(',').filter(Boolean) ?? null;
  const fromTrail = params.get('modulo');
  const prefs = usePrefs();
  const preset = usePreset();
  const [view, setView] = useState<ExerciseView | null>(null);
  const [answers, setAnswers] = useState<Partial<Record<QuestionKey, string>>>({});
  const [result, setResult] = useState<ExerciseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ level: number; answered: number; perfect: number }[]>([]);

  const loadStats = useCallback(() => {
    api<{ levels: typeof stats }>('/api/exercises/stats')
      .then((r) => setStats(r.levels))
      .catch(() => undefined);
  }, []);
  useEffect(loadStats, [loadStats]);

  const next = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setAnswers({});
    try {
      setView(
        await api<ExerciseView>('/api/exercises', {
          method: 'POST',
          body: JSON.stringify({ level, ...(focus ? { setups: focus } : {}) }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!view) return;
    setBusy(true);
    try {
      setResult(
        await api<ExerciseResult>(`/api/exercises/${view.id}/answer`, {
          method: 'POST',
          body: JSON.stringify({ answers }),
        }),
      );
      loadStats();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const candles = view ? (result ? [...view.candles, ...result.future] : view.candles) : [];
  const meta = result?.meta ?? view?.meta ?? null;
  const source = useCallback(
    (ev: LiveSeriesEvents) => new StaticSource(candles, meta as SymbolMeta, ev),
    // recria só quando muda o exercício ou chega a resposta
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view?.id, !!result],
  );
  const yes = answers.tem === 'sim';

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          Exercícios de leitura
          <HelpLink slug="primitivas-price-action" label="Ajuda: leitura de candles" />
        </h1>
        {fromTrail && (
          <Link to="/trilha" className="ml-auto text-xs text-accent underline">
            ← Trilha
          </Link>
        )}
      </div>
      <p className="text-xs text-muted">
        Uma situação real do passado, cortada no último candle fechado. As respostas vêm dos mesmos
        detectores do gráfico. Depois de responder, aparece o que o preço fez em seguida.
        {focus && ` Foco: ${focus.map((s) => SETUP_LABEL[s as SetupId] ?? s).join(', ')}.`}
      </p>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Nível">
        {([1, 2, 3] as const).map((l) => {
          const st = stats.find((s) => s.level === l);
          return (
            <button
              key={l}
              type="button"
              aria-pressed={level === l}
              onClick={() => setLevel(l)}
              className={`rounded border px-2 py-1 text-xs ${level === l ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
            >
              {LEVEL_TEXT[l]}
              {st && st.answered > 0 ? ` · ${st.perfect}/${st.answered} certos` : ''}
            </button>
          );
        })}
        <button
          type="button"
          className={`${primary} ml-auto`}
          disabled={busy}
          onClick={() => void next()}
        >
          {view ? 'Próximo exercício' : 'Começar'}
        </button>
      </div>
      {error && (
        <p className="text-sm text-down" role="alert">
          {error}
        </p>
      )}
      {view && meta && (
        <>
          <div className="h-[45vh] min-h-[280px] overflow-hidden rounded border border-line">
            <ChartView
              key={`${view.id}-${result ? 'r' : 'q'}`}
              id={`exercicio:${view.id}`}
              tf={view.tf}
              preset={preset}
              chartType={prefs.chartType}
              upColor={prefs.upColor}
              downColor={prefs.downColor}
              source={source}
              drawingKey={`exercicio:${view.id}`}
              hideTime={!result}
              hideSetups={!result}
              visibleBars={result ? 120 : 90}
            />
          </div>
          <section className={`${card} space-y-3`} aria-label="Perguntas">
            {view.questions.map((q) => {
              const g = result?.graded.find((x) => x.key === q.key);
              const disabled = !!result || (q.key !== 'tem' && !yes);
              return (
                <fieldset key={q.key} className={disabled && !result ? 'opacity-50' : ''}>
                  <legend className="text-sm font-medium">{q.text}</legend>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {q.options.map((o) => (
                      <label
                        key={o.value}
                        className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs ${answers[q.key] === o.value ? 'border-accent bg-accent/20' : 'border-line'}`}
                      >
                        <input
                          type="radio"
                          name={q.key}
                          value={o.value}
                          disabled={disabled}
                          checked={answers[q.key] === o.value}
                          onChange={() => setAnswers((a) => ({ ...a, [q.key]: o.value }))}
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                  {g && g.applicable && (
                    <p
                      className={`mt-1 text-xs ${g.correct ? 'text-up' : 'text-down'}`}
                      data-testid={`res-${q.key}`}
                    >
                      {g.correct ? '✓ certo' : `✕ resposta: ${g.expectedLabel}`}
                    </p>
                  )}
                  {g && !g.applicable && q.key !== 'tem' && (
                    <p className="mt-1 text-xs text-muted">não se aplica: não havia setup armado</p>
                  )}
                </fieldset>
              );
            })}
            {!result ? (
              <button
                type="button"
                className={primary}
                disabled={busy || !answers.tem}
                onClick={() => void submit()}
              >
                Responder
              </button>
            ) : (
              <div className="space-y-1 rounded bg-bg p-2 text-sm" data-testid="exercise-result">
                <p className="font-semibold">
                  {result.score} de {result.total} {result.total === 1 ? 'certa' : 'certas'}
                  {result.score === result.total ? ' — perfeito' : ''}
                </p>
                <p className="text-xs">
                  Ativo: <b>{result.meta.symbol}</b>.{' '}
                  {result.setups.length
                    ? `Setup armado segundo o detector: ${result.setups.map((s) => SETUP_LABEL[s]).join(', ')}.`
                    : 'O detector não via nenhum setup de compra armado ali.'}
                </p>
                {result.reason && <p className="text-xs text-muted">Por quê: {result.reason}</p>}
                <p className="text-xs">{result.outcome.text}</p>
                <p className="text-[11px] text-muted">
                  Um exercício não diz se o setup "funciona": isso só a estatística do laboratório,
                  com muitos casos, custos e IR.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
