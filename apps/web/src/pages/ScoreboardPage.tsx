import { BASELINE_LABEL, type Scoreboard } from '@radar/core';
import {
  TIMEFRAMES,
  TIMEFRAME_LABEL,
  formatDateTime,
  formatNumber,
  type Timeframe,
} from '@radar/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { candleDate } from '../components/PredictPanel';
import { SymbolSearch } from '../components/SymbolSearch';
import { usePredict, type ScoreboardEntry } from '../lib/predict-store';

const pct = (x: number | null | undefined, d = 0) =>
  x === null || x === undefined ? '—' : `${formatNumber(x * 100, d)}%`;
const ci = (c: { lo: number; hi: number } | null) =>
  c ? `${formatNumber(c.lo * 100, 0)}–${formatNumber(c.hi * 100, 0)}%` : '—';
const short = (id: string) => id.split(':')[1] ?? id;
const methodLabel = (m: string) =>
  m === 'logistica' ? 'camada 2: regressão logística' : 'camada 1: taxas-base';

function VerdictChip({ b, min }: { b: Scoreboard; min: number }) {
  if (b.verdict === 'vantagem')
    return <span className="rounded bg-up/15 px-1.5 py-0.5 text-[11px] text-up">Vantagem</span>;
  if (b.verdict === 'poucos-casos')
    return (
      <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted">
        Poucos casos ({b.n}/{min})
      </span>
    );
  return (
    <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold text-warn">
      SEM VANTAGEM COMPROVADA
    </span>
  );
}

function EntryRow({ e, min }: { e: ScoreboardEntry; min: number }) {
  const b = e.board;
  const best = b.baselines[b.best];
  return (
    <tr className="border-t border-line/60" data-testid="score-row">
      <td className="py-1 pr-2">
        {e.horizon} {e.horizon === 1 ? 'candle' : 'candles'}
      </td>
      <td className="py-1 pr-2 text-right tabular-nums">{b.n}</td>
      <td className="py-1 pr-2 text-right tabular-nums text-muted">
        {e.open} / {e.cancelled}
      </td>
      <td className="py-1 pr-2 text-right tabular-nums">
        {pct(b.model.accuracy, 1)}
        <span className="block text-[10px] text-muted">{ci(b.model.ci)}</span>
      </td>
      <td className="py-1 pr-2 text-right tabular-nums">
        {pct(best.accuracy, 1)}
        <span className="block text-[10px] text-muted">{BASELINE_LABEL[b.best]}</span>
      </td>
      <td className="py-1 pr-2 text-right tabular-nums">
        {b.model.brier === null ? '—' : formatNumber(b.model.brier, 3)}
      </td>
      <td className="py-1 text-right">
        <VerdictChip b={b} min={min} />
      </td>
    </tr>
  );
}

/**
 * Placar do modelo (SPEC §23.2): previsões gravadas ANTES do resultado e conferidas sozinhas pelo
 * servidor. A confiança mostrada no gráfico vem daqui, não do backtest.
 */
export function ScoreboardPage() {
  const {
    targets,
    status,
    entries,
    minCases,
    recent,
    error,
    loadTargets,
    loadScoreboard,
    loadRecent,
    addTarget,
    removeTarget,
  } = usePredict();
  const [symbol, setSymbol] = useState('');
  const [tf, setTf] = useState<Timeframe>('5m');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadTargets(), loadScoreboard(), loadRecent()]).catch((e: Error) =>
      setLoadError(e.message),
    );
  }, [loadTargets, loadScoreboard, loadRecent]);

  const groups = useMemo(() => {
    const by = new Map<string, ScoreboardEntry[]>();
    for (const e of entries ?? []) {
      const k = `${e.symbolId}|${e.tf}|${e.method}`;
      by.set(
        k,
        [...(by.get(k) ?? []), e].sort((a, b) => a.horizon - b.horizon),
      );
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 text-sm">
      <h1 className="text-xl font-semibold">Placar do modelo</h1>
      <p className="text-xs text-muted">
        Cada previsão é gravada pelo servidor no fechamento do candle, <b>antes</b> do resultado, e
        conferida sozinha quando o candle-alvo fecha. O banco não deixa alterar nem apagar. Só conta
        como vantagem com pelo menos {minCases} previsões, o pior caso do acerto (IC de Wilson)
        acima da melhor régua e Brier menor que o de todas. Sem custos nem IR aqui.
      </p>
      {loadError && <p className="text-xs text-down">Erro ao carregar: {loadError}</p>}

      <section
        className="space-y-2 rounded border border-line p-3"
        aria-label="Ativos acompanhados"
      >
        <h2 className="font-semibold">Ativos acompanhados</h2>
        <p className="text-[11px] text-muted">
          Mini-índice e mini-dólar só têm dados com o agente MT5 ligado (busque WIN ou WDO).
          Previsões precisam do servidor sempre ligado: hospedagem que hiberna perde candles e
          cancela previsões.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SymbolSearch
            onPick={setSymbol}
            current={symbol}
            label={symbol ? short(symbol) : 'Escolher ativo'}
          />
          <label className="flex items-center gap-1 text-xs">
            Escala
            <select
              value={tf}
              onChange={(e) => setTf(e.target.value as Timeframe)}
              className="rounded border border-line bg-bg px-1 py-0.5"
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
            disabled={!symbol}
            onClick={() => void addTarget(symbol, tf).catch(() => undefined)}
            className="rounded border border-accent px-2 py-1 text-xs text-accent disabled:opacity-50"
          >
            Acompanhar
          </button>
        </div>
        {error && <p className="text-xs text-down">{error}</p>}
        {targets && targets.length === 0 && (
          <p className="text-xs text-muted">Nenhum ativo acompanhado ainda.</p>
        )}
        <ul className="divide-y divide-line/60">
          {(targets ?? []).map((t) => {
            const st = status.find((s) => s.symbolId === t.symbolId && s.tf === t.tf);
            return (
              <li key={`${t.symbolId}|${t.tf}`} className="flex items-center gap-2 py-1.5 text-xs">
                <Link
                  to={`/grafico?id=${encodeURIComponent(t.symbolId)}&tf=${t.tf}`}
                  className="font-semibold"
                >
                  {short(t.symbolId)} · {TIMEFRAME_LABEL[t.tf]}
                </Link>
                <span className={st?.problem ? 'text-warn' : 'text-muted'}>
                  {st?.problem ??
                    (st?.lastCandleAt
                      ? `${st.candles} candles; último ${candleDate(st.lastCandleAt, t.tf)}`
                      : 'aguardando dados')}
                </span>
                <button
                  type="button"
                  onClick={() => void removeTarget(t.symbolId, t.tf)}
                  className="ml-auto text-muted"
                  aria-label={`Parar de acompanhar ${short(t.symbolId)} ${t.tf}`}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3" aria-label="Placar">
        <h2 className="font-semibold">Placar ao vivo</h2>
        {entries && entries.length === 0 && (
          <p className="text-xs text-muted">
            Nenhuma previsão gravada ainda. Elas começam no próximo fechamento de candle dos ativos
            acompanhados.
          </p>
        )}
        {groups.map(([k, list]) => {
          const e0 = list[0]!;
          return (
            <div key={k} className="overflow-x-auto rounded border border-line p-2">
              <h3 className="text-xs font-semibold">
                {short(e0.symbolId)} · {TIMEFRAME_LABEL[e0.tf]} · {methodLabel(e0.method)}
              </h3>
              <table className="mt-1 w-full min-w-[520px] text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="text-left font-normal">Horizonte</th>
                    <th className="text-right font-normal">Conferidas</th>
                    <th className="text-right font-normal">Abertas / canceladas</th>
                    <th className="text-right font-normal">Acerto (IC 95%)</th>
                    <th className="text-right font-normal">Melhor régua</th>
                    <th className="text-right font-normal">Brier</th>
                    <th className="text-right font-normal">Veredito</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((e) => (
                    <EntryRow key={e.horizon} e={e} min={minCases} />
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </section>

      <section className="space-y-1" aria-label="Últimas previsões">
        <h2 className="font-semibold">Últimas previsões</h2>
        <ul className="divide-y divide-line/60 text-xs">
          {recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2 py-1">
              <span className="tabular-nums text-muted">{formatDateTime(r.createdAt)}</span>
              <span className="font-semibold">
                {short(r.symbolId)} {TIMEFRAME_LABEL[r.tf]}
              </span>
              <span>
                {pct(r.p)} de subir em {r.horizon} (
                {r.method === 'logistica' ? 'modelo' : 'taxas-base'})
              </span>
              <span
                className={
                  r.status === 'conferida'
                    ? r.p > 0.5 === r.up
                      ? 'text-up'
                      : 'text-down'
                    : 'text-muted'
                }
              >
                {r.status === 'aberta'
                  ? 'aguardando'
                  : r.status === 'cancelada'
                    ? `cancelada: ${r.note ?? ''}`
                    : `${r.up ? 'subiu' : 'não subiu'}${r.p === 0.5 ? '' : r.p > 0.5 === r.up ? ' ✓' : ' ✗'}`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
