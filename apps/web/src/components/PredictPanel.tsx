import {
  BASELINE_LABEL,
  LEVEL_LABEL,
  describeSituation,
  type BaselineId,
  type HorizonReport,
  type LevelStat,
  type MethodScore,
  type Scoreboard,
} from '@radar/core';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  isIntraday,
  type Timeframe,
} from '@radar/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { analysisKey, useAnalysis } from '../lib/analysis-store';
import { usePredict, type ScoreboardEntry } from '../lib/predict-store';
import { usePrefs } from '../lib/prefs';
import { useTicket } from './OrderTicket';

const pct = (x: number | null | undefined, d = 0) =>
  x === null || x === undefined ? '—' : `${formatNumber(x * 100, d)}%`;
const ci = (c: { lo: number; hi: number } | null) =>
  c ? `${formatNumber(c.lo * 100, 0)}–${formatNumber(c.hi * 100, 0)}%` : '—';
/** Candle diário+ = meia-noite UTC da data de pregão (ADR-0006): mostrar a data em UTC. */
export const candleDate = (t: number, tf: Timeframe) =>
  isIntraday(tf) ? formatDateTime(t) : formatDate(t, 'UTC');
const brier = (x: number | null) => (x === null ? '—' : formatNumber(x, 3));

/** Linha de uma taxa-base: "quando esta situação aconteceu antes, X% subiu", com n e Wilson. */
function LevelRow({ l, min }: { l: LevelStat; min: number }) {
  return (
    <tr className="border-t border-line/60">
      <td className="py-1 pr-2">{LEVEL_LABEL[l.id]}</td>
      <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums">{l.n}</td>
      <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums">
        {pct(l.rate)}
        {l.n > 0 && l.n < min && <span className="block text-[10px] text-warn">poucos casos</span>}
      </td>
      <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums text-muted">{ci(l.ci)}</td>
    </tr>
  );
}

function ScoreTable({ b }: { b: Scoreboard }) {
  const rows: [string, MethodScore, boolean][] = [
    ['Esta regra', b.model, true],
    ...(Object.keys(b.baselines) as BaselineId[]).map(
      (id) => [BASELINE_LABEL[id], b.baselines[id], false] as [string, MethodScore, boolean],
    ),
  ];
  return (
    <table className="w-full text-xs">
      <thead className="text-muted">
        <tr>
          <th className="text-left font-normal">Quem</th>
          <th className="pl-2 text-right font-normal">Acerto</th>
          <th className="whitespace-nowrap pl-2 text-right font-normal">IC 95%</th>
          <th className="pl-2 text-right font-normal" title="Erro da probabilidade: menor é melhor">
            Brier
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, m, main]) => (
          <tr key={label} className={`border-t border-line/60 ${main ? 'font-semibold' : ''}`}>
            <td className="py-1 pr-2">{label}</td>
            <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums">
              {pct(m.accuracy, 1)}
            </td>
            <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums text-muted">
              {main ? ci(m.ci) : ''}
            </td>
            <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums">
              {brier(m.brier)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Headline({
  h,
  live,
  minCases,
}: {
  h: HorizonReport;
  live: ScoreboardEntry | undefined;
  minCases: number;
}) {
  const p = h.current.p;
  const liveBoard = live?.board;
  const noEdge =
    h.history.verdict !== 'vantagem' || (liveBoard && liveBoard.verdict === 'sem-vantagem');
  const why =
    h.history.verdict === 'poucos-casos'
      ? `o histórico deste ativo tem só ${h.history.n} previsões conferidas (mínimo ${minCases})`
      : h.history.verdict === 'sem-vantagem'
        ? 'no passado deste ativo, fora da amostra, a regra não venceu as réguas (moeda, sempre sobe, persistência)'
        : 'o placar ao vivo, com amostra suficiente, não venceu as réguas';
  return (
    <div
      className={`rounded border px-3 py-2 ${noEdge ? 'border-warn/50 bg-warn/10' : 'border-accent/50 bg-accent/10'}`}
      data-testid="predict-headline"
    >
      {noEdge ? (
        <>
          <p className="text-base font-bold tracking-wide text-warn">SEM VANTAGEM COMPROVADA</p>
          <p className="mt-1 text-xs text-muted">
            Motivo: {why}. A regra diria {pct(p)} de fechar mais alto daqui a {h.horizon}{' '}
            {h.horizon === 1 ? 'candle' : 'candles'} — trate como moeda.
          </p>
        </>
      ) : (
        <>
          <p className="text-2xl font-bold tabular-nums">{pct(p)}</p>
          <p className="text-xs">
            de chance de o fechamento daqui a {h.horizon} {h.horizon === 1 ? 'candle' : 'candles'}{' '}
            ficar mais alto que o de agora. Não é certeza.
          </p>
        </>
      )}
      <p className="mt-2 border-t border-line/60 pt-1 text-xs" data-testid="predict-confidence">
        <b>Confiança (placar ao vivo):</b>{' '}
        {!liveBoard || liveBoard.n === 0
          ? 'nenhuma previsão conferida ainda — acompanhe no placar para saber.'
          : liveBoard.verdict === 'poucos-casos'
            ? `${liveBoard.n} de ${minCases} previsões conferidas: ainda não comprovada (acerto até agora ${pct(liveBoard.model.accuracy)}).`
            : `acerto ${pct(liveBoard.model.accuracy, 1)} (IC ${ci(liveBoard.model.ci)}) em ${liveBoard.n} previsões, contra ${pct(liveBoard.baselines[liveBoard.best].accuracy, 1)} de "${BASELINE_LABEL[liveBoard.best]}".`}
      </p>
    </div>
  );
}

/**
 * Previsão honesta (SPEC §23.2, camada 1): probabilidade com o histórico de acerto ao lado. Calculada no
 * worker com o MESMO código do placar do servidor; "SEM VANTAGEM COMPROVADA" quando não vence as réguas.
 */
export function PredictPanel({ id, tf }: { id: string; tf: Timeframe }) {
  const aKey = analysisKey(id, tf);
  const report = useAnalysis((s) => s.predictions[aKey]);
  const mode = usePrefs((s) => s.mode);
  const { targets, entries, minCases, loadTargets, loadScoreboard, addTarget, error } =
    usePredict();
  const [hi, setHi] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    useAnalysis.getState().wantPrediction(aKey, true);
    return () => useAnalysis.getState().wantPrediction(aKey, false);
  }, [aKey]);
  useEffect(() => {
    void loadTargets().catch(() => undefined);
    void loadScoreboard().catch(() => undefined);
  }, [loadTargets, loadScoreboard]);

  if (report === undefined)
    return <p className="p-3 text-xs text-muted">Calculando a previsão com o histórico…</p>;
  if (report === null)
    return (
      <p className="p-3 text-xs text-muted">
        Candles fechados de menos para prever (a regra precisa de mais de 200 para aquecer as
        médias). Nada inventado.
      </p>
    );

  const h = report.horizons[Math.min(hi, report.horizons.length - 1)]!;
  const live = entries?.find(
    (e) => e.symbolId === id && e.tf === tf && e.horizon === h.horizon && e.method === 'taxa-base',
  );
  const following = targets?.some((t) => t.symbolId === id && t.tf === tf) ?? false;
  const sit = describeSituation(report.situation, tf);
  const follow = () => {
    const note = `Seguindo a previsão do Radar: ${pct(h.current.p)} de fechar mais alto em ${h.horizon} candle(s) (taxa-base; histórico: ${h.history.verdict === 'vantagem' ? 'com vantagem' : 'SEM VANTAGEM COMPROVADA'}).`;
    useTicket.getState().open(id, tf, { note });
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-sm" data-testid="predict-panel">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Horizonte:</span>
        <div className="flex gap-1" role="group" aria-label="Horizonte da previsão">
          {report.horizons.map((x, k) => (
            <button
              key={x.horizon}
              type="button"
              onClick={() => setHi(k)}
              aria-pressed={k === hi}
              className={`rounded border px-2 py-0.5 text-xs ${k === hi ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
            >
              {x.horizon} {x.horizon === 1 ? 'candle' : 'candles'}
            </button>
          ))}
        </div>
      </div>

      <Headline h={h} live={live} minCases={minCases} />

      <section aria-label="Situação de agora">
        <h3 className="text-xs font-semibold">Situação no último candle fechado</h3>
        <ul className="mt-1 list-disc pl-4 text-xs text-muted">
          {sit.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section aria-label="Taxas-base">
        <h3 className="text-xs font-semibold">Quando aconteceu antes neste ativo</h3>
        <p className="text-[11px] text-muted">
          % de vezes em que o fechamento {h.horizon} {h.horizon === 1 ? 'candle' : 'candles'} depois
          ficou mais alto. Casos sem sobreposição; IC de Wilson (95%).
        </p>
        <table className="mt-1 w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="text-left font-normal">Situação</th>
              <th className="pl-2 text-right font-normal">n</th>
              <th className="pl-2 text-right font-normal">Subiu</th>
              <th className="whitespace-nowrap pl-2 text-right font-normal">IC 95%</th>
            </tr>
          </thead>
          <tbody>
            {[...h.current.levels, ...h.current.facets].map((l) => (
              <LevelRow key={l.id} l={l} min={minCases} />
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Histórico de acerto">
        <h3 className="text-xs font-semibold">Histórico de acerto (fora da amostra)</h3>
        <p className="text-[11px] text-muted">
          Em cada ponto do passado a regra só conhecia os casos já fechados. {h.history.n} previsões
          {h.history.from !== null &&
            ` de ${candleDate(h.history.from, tf)} a ${candleDate(h.history.to as number, tf)}`}
          . Sem custos nem IR (o resultado em dinheiro vem na próxima etapa).
        </p>
        <div className="mt-1">
          <ScoreTable b={h.history} />
        </div>
        {h.history.calibration.length > 0 && (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer text-muted">Calibração (dizia × aconteceu)</summary>
            <table className="mt-1 w-full">
              <tbody>
                {h.history.calibration.map((c) => (
                  <tr key={c.from} className="border-t border-line/60">
                    <td className="py-0.5">
                      Dizia {formatNumber(c.from * 100, 0)}–{formatNumber(c.to * 100, 0)}%
                    </td>
                    <td className="py-0.5 text-right tabular-nums">subiu {pct(c.upRate)}</td>
                    <td className="py-0.5 text-right tabular-nums text-muted">n {c.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>

      <section className="space-y-2" aria-label="Placar ao vivo">
        <h3 className="text-xs font-semibold">Placar ao vivo</h3>
        <p className="text-[11px] text-muted">
          O servidor grava a previsão no fechamento do candle, ANTES do resultado, e confere
          sozinho. Precisa do servidor sempre ligado.
        </p>
        <div className="flex flex-wrap gap-2">
          {following ? (
            <span className="rounded bg-up/15 px-2 py-1 text-xs text-up">
              ✓ Acompanhado no placar
            </span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void addTarget(id, tf)
                  .catch(() => undefined)
                  .finally(() => setBusy(false));
              }}
              className="rounded border border-accent px-2 py-1 text-xs text-accent"
            >
              Acompanhar no placar
            </button>
          )}
          <Link to="/placar" className="rounded border border-line px-2 py-1 text-xs text-muted">
            Ver placar
          </Link>
          {mode === 'treino' && h.current.p > 0.5 && (
            <button
              type="button"
              onClick={follow}
              className="rounded border border-line px-2 py-1 text-xs"
            >
              Seguir no Modo Treino
            </button>
          )}
        </div>
        {mode === 'treino' && h.current.p <= 0.5 && (
          <p className="text-[11px] text-muted">
            A previsão não é de alta e o Modo Treino só compra: acompanhe pelo placar.
          </p>
        )}
        {error && <p className="text-xs text-down">{error}</p>}
      </section>
    </div>
  );
}
