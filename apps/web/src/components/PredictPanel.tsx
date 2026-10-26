import {
  BASELINE_LABEL,
  DEFAULT_PREDICT,
  FEATURE_LABEL,
  LEVEL_LABEL,
  describeSituation,
  type BaselineId,
  type CalibrationBin,
  type HorizonReport,
  type LevelStat,
  type MethodScore,
  type Scoreboard,
  type SignalBacktest,
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
import { cdiBetween } from '../lib/macro';
import { usePredict, type ScoreboardEntry } from '../lib/predict-store';
import { usePrefs } from '../lib/prefs';
import { useTicket } from './OrderTicket';

const pct = (x: number | null | undefined, d = 0) =>
  x === null || x === undefined ? '—' : `${formatNumber(x * 100, d)}%`;
const signed = (x: number | null | undefined) =>
  x === null || x === undefined ? '—' : `${x > 0 ? '+' : ''}${formatNumber(x * 100, 1)}%`;
const ci = (c: { lo: number; hi: number } | null) =>
  c ? `${formatNumber(c.lo * 100, 0)}–${formatNumber(c.hi * 100, 0)}%` : '—';
/** Candle diário+ = meia-noite UTC da data de pregão (ADR-0006): mostrar a data em UTC. */
export const candleDate = (t: number, tf: Timeframe) =>
  isIntraday(tf) ? formatDateTime(t) : formatDate(t, 'UTC');
const brier = (x: number | null) => (x === null ? '—' : formatNumber(x, 3));
const candles = (n: number) => `${n} ${n === 1 ? 'candle' : 'candles'}`;

type Method = 'taxa-base' | 'logistica';
const METHOD_LABEL: Record<Method, string> = {
  'taxa-base': 'Camada 1 — taxas-base',
  logistica: 'Camada 2 — regressão logística',
};

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

function ScoreTable({ b, label }: { b: Scoreboard; label: string }) {
  const rows: [string, MethodScore, boolean][] = [
    [label, b.model, true],
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
        {rows.map(([name, m, main]) => (
          <tr key={name} className={`border-t border-line/60 ${main ? 'font-semibold' : ''}`}>
            <td className="py-1 pr-2">{name}</td>
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

function verdictText(b: Scoreboard, min: number) {
  return b.verdict === 'vantagem'
    ? 'venceu as réguas'
    : b.verdict === 'poucos-casos'
      ? `poucos casos (${b.n} de ${min})`
      : 'não venceu as réguas';
}

function confidence(live: ScoreboardEntry | undefined, min: number): string {
  const b = live?.board;
  if (!b || b.n === 0) return 'nenhuma previsão conferida ainda — acompanhe no placar para saber.';
  if (b.verdict === 'poucos-casos')
    return `${b.n} de ${min} previsões conferidas: ainda não comprovada (acerto até agora ${pct(b.model.accuracy)}).`;
  return `acerto ${pct(b.model.accuracy, 1)} (IC ${ci(b.model.ci)}) em ${b.n} previsões, contra ${pct(b.baselines[b.best].accuracy, 1)} de "${BASELINE_LABEL[b.best]}"${b.verdict === 'vantagem' ? '' : ' — sem vantagem'}.`;
}

/**
 * Destaque: só mostra a probabilidade de uma camada que venceu as réguas fora da amostra e que o placar
 * ao vivo (com amostra) não desmentiu; se nenhuma, "SEM VANTAGEM COMPROVADA" (SPEC §23.2, ADR-0034).
 */
function Headline({
  h,
  live,
  minCases,
}: {
  h: HorizonReport;
  live: Partial<Record<Method, ScoreboardEntry>>;
  minCases: number;
}) {
  const cands: { m: Method; p: number | null; b: Scoreboard }[] = [
    { m: 'logistica', p: h.model.current?.p ?? null, b: h.model.history },
    { m: 'taxa-base', p: h.current.p, b: h.history },
  ];
  const ok = cands.filter(
    (c) =>
      c.p !== null && c.b.verdict === 'vantagem' && live[c.m]?.board.verdict !== 'sem-vantagem',
  );
  const shown = ok.sort((a, b) => (a.b.model.brier ?? 1) - (b.b.model.brier ?? 1))[0];
  return (
    <div
      className={`rounded border px-3 py-2 ${shown ? 'border-accent/50 bg-accent/10' : 'border-warn/50 bg-warn/10'}`}
      data-testid="predict-headline"
    >
      {shown ? (
        <>
          <p className="text-2xl font-bold tabular-nums">{pct(shown.p)}</p>
          <p className="text-xs">
            de chance de o fechamento daqui a {candles(h.horizon)} ficar mais alto que o de agora (
            {METHOD_LABEL[shown.m]}). Não é certeza.
          </p>
        </>
      ) : (
        <>
          <p className="text-base font-bold tracking-wide text-warn">SEM VANTAGEM COMPROVADA</p>
          <p className="mt-1 text-xs text-muted">
            Nenhuma camada venceu as réguas (moeda, sempre sobe, persistência) fora da amostra neste
            ativo e horizonte de {candles(h.horizon)}. Diriam: taxas-base {pct(h.current.p)}; modelo{' '}
            {h.model.current ? pct(h.model.current.p) : 'sem treino suficiente'}. Trate como moeda.
          </p>
        </>
      )}
      <div
        className="mt-2 space-y-0.5 border-t border-line/60 pt-1 text-xs"
        data-testid="predict-confidence"
      >
        <p>
          <b>Confiança (placar ao vivo)</b>
        </p>
        {(['taxa-base', 'logistica'] as const).map((m) => (
          <p key={m}>
            <span className="text-muted">{m === 'taxa-base' ? 'Taxas-base' : 'Modelo'}:</span>{' '}
            {confidence(live[m], minCases)}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Curva de calibração: probabilidade dita × frequência real, com a diagonal da calibração perfeita. */
function CalibrationChart({ base, model }: { base: CalibrationBin[]; model: CalibrationBin[] }) {
  const S = 160;
  const pad = 24;
  const x = (v: number) => pad + v * (S - pad - 16);
  const y = (v: number) => S - pad - v * (S - pad - 8);
  const r = (n: number) => Math.min(7, 2.5 + Math.sqrt(n) / 3);
  const series: [string, CalibrationBin[], string][] = [
    ['Taxas-base', base, 'var(--color-muted)'],
    ['Modelo', model, 'var(--color-accent)'],
  ];
  return (
    <figure className="text-[10px]">
      <svg
        viewBox={`0 0 ${S} ${S}`}
        className="h-40 w-40"
        role="img"
        aria-label="Curva de calibração: probabilidade dita contra frequência real de alta"
      >
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(1)}
          y2={y(1)}
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeDasharray="3 3"
        />
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(0)} stroke="currentColor" strokeOpacity={0.4} />
        <line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(1)} stroke="currentColor" strokeOpacity={0.4} />
        {[0, 0.5, 1].map((v) => (
          <g key={v} fill="currentColor" fillOpacity={0.6}>
            <text x={x(v)} y={S - 8} textAnchor="middle">
              {v * 100}%
            </text>
            <text x={4} y={y(v) + 3}>
              {v * 100}
            </text>
          </g>
        ))}
        {series.map(([name, bins, color]) =>
          bins.map((b) => (
            <circle
              key={`${name}-${b.from}`}
              cx={x(b.meanP)}
              cy={y(b.upRate)}
              r={r(b.n)}
              fill={color}
              fillOpacity={0.75}
              stroke="var(--color-panel)"
              strokeWidth={1}
            >
              <title>{`${name}: dizia ${pct(b.meanP)} → subiu ${pct(b.upRate)} (n ${b.n})`}</title>
            </circle>
          )),
        )}
      </svg>
      <figcaption className="flex gap-3 text-muted">
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-muted" /> Taxas-base
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-accent" /> Modelo
        </span>
        <span>tracejado = calibração perfeita</span>
      </figcaption>
    </figure>
  );
}

/** CDI acumulado no mesmo período (servidor, BCB). */
function useCdi(from: number | null, to: number | null) {
  const [v, setV] = useState<{ key: string; acc: number | null; error: boolean } | null>(null);
  const key = `${from}|${to}`;
  useEffect(() => {
    if (from === null || to === null) return;
    let alive = true;
    void cdiBetween(from, to)
      .then((r) => alive && setV({ key, acc: r?.acc ?? null, error: false }))
      .catch(() => alive && setV({ key, acc: null, error: true }));
    return () => {
      alive = false;
    };
  }, [from, to, key]);
  return v?.key === key ? v : null;
}

function MoneyColumn({ r }: { r: SignalBacktest }) {
  const cdi = useCdi(r.from, r.to);
  const final = r.totalReturnAfterTax ?? r.totalReturn;
  return (
    <>
      <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums">
        {r.trades.length}
        <span className="block text-[10px] text-muted">{r.sample}</span>
      </td>
      <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums">
        {signed(r.totalReturn)}
      </td>
      <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums">
        {r.totalReturnAfterTax === null ? 'n/d' : signed(r.totalReturnAfterTax)}
      </td>
      <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums">{signed(r.buyHold)}</td>
      <td
        className={`whitespace-nowrap py-1 pl-2 text-right tabular-nums ${cdi?.acc !== null && cdi?.acc !== undefined && final < cdi.acc ? 'text-down' : ''}`}
      >
        {cdi === null ? '…' : cdi.acc === null ? 'sem dado' : signed(cdi.acc)}
      </td>
    </>
  );
}

/**
 * Previsão honesta (SPEC §23.2): probabilidade com o histórico de acerto ao lado, nas duas camadas,
 * calculada no worker com o MESMO código do placar do servidor.
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
  const liveOf = (m: Method) =>
    entries?.find(
      (e) => e.symbolId === id && e.tf === tf && e.horizon === h.horizon && e.method === m,
    );
  const live = { 'taxa-base': liveOf('taxa-base'), logistica: liveOf('logistica') };
  const following = targets?.some((t) => t.symbolId === id && t.tf === tf) ?? false;
  const sit = describeSituation(report.situation, tf);
  const pFollow = h.model.current?.p ?? h.current.p;
  const anyEdge = h.history.verdict === 'vantagem' || h.model.history.verdict === 'vantagem';
  const follow = () => {
    const note = `Seguindo a previsão do Radar: ${pct(pFollow)} de fechar mais alto em ${candles(h.horizon)} (${anyEdge ? 'com vantagem no histórico' : 'SEM VANTAGEM COMPROVADA'}).`;
    useTicket.getState().open(id, tf, { note });
  };
  const period = (b: Scoreboard) =>
    b.from !== null ? ` de ${candleDate(b.from, tf)} a ${candleDate(b.to as number, tf)}` : '';

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
              {candles(x.horizon)}
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
        <h3 className="text-xs font-semibold">Camada 1 — quando aconteceu antes neste ativo</h3>
        <p className="text-[11px] text-muted">
          % de vezes em que o fechamento {candles(h.horizon)} depois ficou mais alto. Casos sem
          sobreposição; IC de Wilson (95%).
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

      <section aria-label="Modelo">
        <h3 className="text-xs font-semibold">Camada 2 — modelo simples (regressão logística)</h3>
        {h.model.current ? (
          <>
            <p className="text-[11px] text-muted">
              Hoje diria {pct(h.model.current.p)} (treinado com {h.model.current.n} casos). O que
              mais pesou (+ puxa para alta, − para baixa):
            </p>
            <ul className="mt-1 text-xs">
              {h.model.current.coefficients.slice(0, 5).map((c) => (
                <li key={c.name} className="flex justify-between gap-2">
                  <span>{FEATURE_LABEL[c.name]}</span>
                  <span className="tabular-nums text-muted">
                    {c.weight > 0 ? '+' : '−'}
                    {formatNumber(Math.abs(c.weight), 2)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-[11px] text-muted">
            Casos de treino de menos para ajustar o modelo (mínimo {DEFAULT_PREDICT.minTrain}). Nada
            inventado.
          </p>
        )}
      </section>

      <section aria-label="Histórico de acerto">
        <h3 className="text-xs font-semibold">Histórico de acerto (fora da amostra)</h3>
        <p className="text-[11px] text-muted">
          Taxas-base: em cada ponto a regra só conhecia os casos já fechados ({h.history.n}{' '}
          previsões
          {period(h.history)}; {verdictText(h.history, minCases)}). Modelo: walk-forward, reajuste a
          cada {DEFAULT_PREDICT.refitEvery} candles, purga de {candles(h.horizon)} e embargo de{' '}
          {DEFAULT_PREDICT.embargo} ({h.model.history.n} previsões{period(h.model.history)};{' '}
          {verdictText(h.model.history, minCases)}).
        </p>
        <div className="mt-1 space-y-2">
          <ScoreTable b={h.history} label="Taxas-base" />
          <ScoreTable b={h.model.history} label="Modelo" />
        </div>
      </section>

      <section aria-label="Calibração">
        <h3 className="text-xs font-semibold">Calibração (dizia × aconteceu)</h3>
        <CalibrationChart base={h.history.calibration} model={h.model.history.calibration} />
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Ver em tabela</summary>
          <table className="mt-1 w-full">
            <tbody>
              {(
                [
                  ['Taxas-base', h.history.calibration],
                  ['Modelo', h.model.history.calibration],
                ] as const
              ).flatMap(([name, bins]) =>
                bins.map((c) => (
                  <tr key={`${name}-${c.from}`} className="border-t border-line/60">
                    <td className="py-0.5">{name}</td>
                    <td className="py-0.5">
                      dizia {formatNumber(c.from * 100, 0)}–{formatNumber(c.to * 100, 0)}%
                    </td>
                    <td className="py-0.5 text-right tabular-nums">subiu {pct(c.upRate)}</td>
                    <td className="py-0.5 text-right tabular-nums text-muted">n {c.n}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </details>
      </section>

      {h.money && (
        <section aria-label="Resultado em dinheiro">
          <h3 className="text-xs font-semibold">Operando o sinal (fora da amostra)</h3>
          <p className="text-[11px] text-muted">
            Compra na abertura do candle seguinte quando a probabilidade chega a{' '}
            {pct(0.5 + DEFAULT_PREDICT.margin)} e sai no fechamento do candle-alvo; com spread,
            derrapagem, taxas e IR (B3). Comparado com comprar e segurar e com o CDI do mesmo
            período.
          </p>
          <div className="overflow-x-auto">
            <table className="mt-1 w-full min-w-[320px] text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="text-left font-normal">Camada</th>
                  <th className="pl-2 text-right font-normal">Oper.</th>
                  <th className="pl-2 text-right font-normal">Após custos</th>
                  <th className="pl-2 text-right font-normal">Após IR</th>
                  <th className="pl-2 text-right font-normal">Segurar</th>
                  <th className="pl-2 text-right font-normal">CDI</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Taxas-base', h.money.base],
                    ['Modelo', h.money.model],
                  ] as const
                ).map(([name, r]) => (
                  <tr key={name} className="border-t border-line/60" data-testid="money-row">
                    <td className="py-1 pr-2">{name}</td>
                    <MoneyColumn r={r} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-muted">
            {[...new Set([...h.money.base.notes, ...h.money.model.notes])].map((n) => (
              <li key={n}>{n}</li>
            ))}
            <li>Segurar = comprar no começo do período e segurar até o fim (com custos).</li>
            <li>Vermelho no CDI = o sinal rendeu menos que deixar o dinheiro no CDI.</li>
          </ul>
        </section>
      )}

      <section className="space-y-2" aria-label="Placar ao vivo">
        <h3 className="text-xs font-semibold">Placar ao vivo</h3>
        <p className="text-[11px] text-muted">
          O servidor grava a previsão das duas camadas no fechamento do candle, ANTES do resultado,
          e confere sozinho. Precisa do servidor sempre ligado.
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
          {mode === 'treino' && pFollow > 0.5 && (
            <button
              type="button"
              onClick={follow}
              className="rounded border border-line px-2 py-1 text-xs"
            >
              Seguir no Modo Treino
            </button>
          )}
        </div>
        {mode === 'treino' && pFollow <= 0.5 && (
          <p className="text-[11px] text-muted">
            A previsão não é de alta e o Modo Treino só compra: acompanhe pelo placar.
          </p>
        )}
        {error && <p className="text-xs text-down">{error}</p>}
      </section>
    </div>
  );
}
