import { SETUP_LABEL, STATE_LABEL, applyFilters } from '@radar/core';
import {
  SCAN_MAS,
  SCAN_MA_LABEL,
  VOLUME_QUALITY_LABEL,
  WEEKLY_MAS,
  delayLabel,
  formatDateTime,
  formatNumber,
  formatSessionDate,
  isIntraday,
  type FilterOutcome,
  type ScanFilters,
  type ScanRow,
  type ScanSetupHit,
  type ScanSnapshot,
  type SlopeDir,
  type Timeframe,
} from '@radar/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sortRows, type ScanSortKey, type SortDir } from '../lib/scanner-sort';
import { Sparkline } from './Sparkline';

type Tab = 'pass' | 'chart' | 'all' | 'errors';
type Mode = 'tabela' | 'cartoes';

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${formatNumber(v * 100, 0)}%`;
const num = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? '—' : formatNumber(v, d);
const when = (t: number, tf: Timeframe) => (isIntraday(tf) ? formatDateTime(t) : formatSessionDate(t));
const ARROW: Record<SlopeDir, string> = { subindo: '↑', descendo: '↓', plana: '→' };

/** Link do ativo: abre o gráfico no modo 3 escalas (SPEC §14). */
export const chartLink = (id: string, tf: Timeframe) =>
  `/grafico?id=${encodeURIComponent(id)}&tf=${tf}&modo=3`;

function sourceText(r: ScanRow): string {
  const s = r.source;
  if (!s) return '—';
  return `${s.label} · ${delayLabel(s.delay)} · ${VOLUME_QUALITY_LABEL[s.volume]}${
    s.adjusted === 'no' ? ' · sem ajuste por proventos' : ''
  }`;
}

function SetupChip({ h, decimals }: { h: ScanSetupHit; decimals: number }) {
  const f = (v: number | null) => (v === null ? '—' : formatNumber(v, decimals));
  const title = [
    h.reason,
    h.trigger !== null ? `gatilho ${f(h.trigger)}` : '',
    h.stop !== null ? `stop ${f(h.stop)}` : '',
    h.target !== null ? `alvo ${f(h.target)}` : '',
    ...h.notes,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      title={title}
      className={`inline-block rounded border px-1 py-0.5 text-[11px] whitespace-nowrap ${
        h.againstHigher ? 'border-down/70 text-down' : 'border-line text-text'
      }`}
    >
      {h.againstHigher ? '⚠ ' : ''}
      {SETUP_LABEL[h.setup].replace('Setup ', '')} {STATE_LABEL[h.state].toLowerCase()}{' '}
      {h.side === 'buy' ? '(compra)' : '(venda)'}
    </span>
  );
}

function Slopes({ r }: { r: ScanRow }) {
  const a = r.analysis;
  if (!a) return <>—</>;
  const tf = SCAN_MAS.map((m) => `${SCAN_MA_LABEL[m]} ${a.slopes[m] ? ARROW[a.slopes[m]] : '–'}`);
  const w = a.weekly
    ? WEEKLY_MAS.map((m) => `${SCAN_MA_LABEL[m]} ${a.weekly!.slopes[m] ? ARROW[a.weekly!.slopes[m]!] : '–'}`)
    : null;
  return (
    <span className="text-[11px] whitespace-nowrap">
      {tf.join(' ')}
      <span className="block text-muted">{w ? `semanal: ${w.join(' ')}` : 'semanal: sem dado'}</span>
    </span>
  );
}

const COLUMNS: { key: ScanSortKey | null; label: string; title?: string }[] = [
  { key: 'symbol', label: 'Ativo' },
  { key: 'close', label: 'Fechamento' },
  { key: 'setups', label: 'Setups ativos' },
  { key: 'trend', label: 'Tendência' },
  { key: 'adx', label: 'ADX' },
  { key: null, label: 'Média respeitada' },
  { key: null, label: 'Inclinações' },
  { key: 'ddTf', label: 'Queda 52 candles', title: 'Queda desde o topo dos últimos 52 candles desta escala' },
  { key: 'dd52', label: 'Queda 52 semanas', title: 'Queda desde o topo das últimas 52 semanas fechadas' },
  { key: 'relVolume', label: 'Vol. relativo', title: 'Volume do último candle ÷ média dos 21 anteriores' },
  { key: 'source', label: 'Fonte e atraso' },
  { key: null, label: 'Filtros' },
];

function Table({
  rows,
  outcome,
  tf,
  open,
}: {
  rows: ScanRow[];
  outcome: Map<string, FilterOutcome>;
  tf: Timeframe;
  open(id: string): void;
}) {
  const [sort, setSort] = useState<{ key: ScanSortKey; dir: SortDir }>({ key: 'symbol', dir: 'asc' });
  const sorted = useMemo(() => sortRows(rows, sort.key, sort.dir), [rows, sort]);
  const click = (key: ScanSortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'symbol' || key === 'source' ? 'asc' : 'desc' },
    );
  return (
    <div className="overflow-x-auto rounded border border-line">
      <table className="w-full min-w-[64rem] text-left text-xs" aria-label="Resultado do scanner">
        <thead className="bg-panel-2">
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.label}
                className="px-2 py-1.5 font-normal text-muted"
                {...(c.key
                  ? {
                      'aria-sort':
                        sort.key === c.key
                          ? sort.dir === 'asc'
                            ? ('ascending' as const)
                            : ('descending' as const)
                          : ('none' as const),
                    }
                  : {})}
                title={c.title}
              >
                {c.key ? (
                  <button type="button" className="hover:text-text" onClick={() => click(c.key!)}>
                    {c.label}
                    {sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const a = r.analysis;
            const o = outcome.get(r.symbolId);
            return (
              <tr key={r.symbolId} className="border-t border-line/60 align-top">
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    className="text-left font-semibold text-accent underline-offset-2 hover:underline"
                    onClick={() => open(r.symbolId)}
                    aria-label={`Abrir ${r.symbol} no gráfico (3 escalas)`}
                  >
                    {r.symbol}
                  </button>
                  <span className="block max-w-40 truncate text-[11px] text-muted">{r.name}</span>
                </td>
                <td className="px-2 py-1.5 tabular-nums">
                  {a ? formatNumber(a.lastClose, r.decimals) : '—'}
                  {a && <span className="block text-[11px] text-muted">{when(a.lastTime, tf)}</span>}
                </td>
                <td className="px-2 py-1.5">
                  {a?.setups.length ? (
                    <span className="flex flex-col items-start gap-0.5">
                      {a.setups.map((h) => (
                        <SetupChip key={`${h.setup}:${h.side}`} h={h} decimals={r.decimals} />
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {a?.trend ?? '—'}
                  {a?.higher && (
                    <span className="block text-[11px] text-muted">
                      {a.higher.tfLabel}: {a.higher.trend}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{num(a?.adx)}</td>
                <td className="px-2 py-1.5">
                  {a?.respected
                    ? `${SCAN_MA_LABEL[a.respected.ma]} (${a.respected.hits}/${a.respected.of})`
                    : '—'}
                </td>
                <td className="px-2 py-1.5">
                  <Slopes r={r} />
                </td>
                <td className="px-2 py-1.5 tabular-nums">{pct(a?.drawdown.tf)}</td>
                <td className="px-2 py-1.5 tabular-nums">{pct(a?.drawdown.w52)}</td>
                <td className="px-2 py-1.5 tabular-nums">
                  {a?.relVolume === null || !a ? '—' : `${num(a.relVolume)}×`}
                </td>
                <td className="max-w-48 px-2 py-1.5 text-[11px] text-muted">
                  {sourceText(r)}
                  {r.source?.status.state !== 'ok' && r.source && (
                    <span className="block text-down">fonte com erro</span>
                  )}
                </td>
                <td className="max-w-56 px-2 py-1.5 text-[11px]">
                  {r.error ? (
                    <span className="text-down">⚠ {r.error}</span>
                  ) : o?.pass ? (
                    <span className="text-up">✓ passou</span>
                  ) : (
                    <span className={o?.chartOnly ? 'text-warn' : 'text-muted'} title={o?.reasons.join('\n')}>
                      {o?.reasons[0] ?? '—'}
                      {(o?.reasons.length ?? 0) > 1 ? ` (+${o!.reasons.length - 1})` : ''}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Card({
  r,
  outcome,
  tf,
  open,
}: {
  r: ScanRow;
  outcome: FilterOutcome | undefined;
  tf: Timeframe;
  open(id: string): void;
}) {
  const a = r.analysis;
  const first = a?.spark[0];
  const change = a && first ? a.lastClose / first - 1 : null;
  return (
    <li className="rounded border border-line bg-panel p-2" data-testid="scan-card">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        onClick={() => open(r.symbolId)}
        aria-label={`Abrir ${r.symbol} no gráfico (3 escalas)`}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{r.symbol}</span>
          <span className="block truncate text-[11px] text-muted">{r.name}</span>
          {a && (
            <span className="mt-1 block text-sm tabular-nums">
              {formatNumber(a.lastClose, r.decimals)}{' '}
              <span className="text-xs text-muted">
                {change === null
                  ? ''
                  : `${change >= 0 ? '+' : ''}${formatNumber(change * 100, 1)}% em ${a.spark.length} candles`}
              </span>
            </span>
          )}
          {a && <span className="block text-[11px] text-muted">fechou em {when(a.lastTime, tf)}</span>}
        </span>
        {a && <Sparkline values={a.spark} decimals={r.decimals} />}
      </button>
      {r.error ? (
        <p className="mt-1 text-xs text-down">⚠ {r.error}</p>
      ) : (
        a && (
          <div className="mt-1 space-y-1 text-xs">
            <div className="flex flex-wrap gap-1">
              {a.setups.map((h) => (
                <SetupChip key={`${h.setup}:${h.side}`} h={h} decimals={r.decimals} />
              ))}
              {!a.setups.length && <span className="text-muted">Nenhum setup ativo</span>}
            </div>
            <p className="text-muted">
              Tendência <b className="text-text">{a.trend}</b> · ADX {num(a.adx)} · queda 52 sem.{' '}
              {pct(a.drawdown.w52)} · vol. {a.relVolume === null ? '—' : `${num(a.relVolume)}×`}
            </p>
            {outcome && !outcome.pass && (
              <p className={outcome.chartOnly ? 'text-warn' : 'text-muted'}>
                {outcome.reasons.join(' · ')}
              </p>
            )}
          </div>
        )
      )}
      {r.notes.length > 0 && (
        <p className="mt-1 text-[11px] text-warn">{r.notes.join(' ')}</p>
      )}
      <p className="mt-1 border-t border-line/60 pt-1 text-[11px] text-muted">{sourceText(r)}</p>
    </li>
  );
}

/**
 * Resultado do scanner: abas (passaram / só parte gráfica / todos / erros), tabela ordenável e cartões
 * com mini-gráfico. Os filtros da tela são aplicados de novo pelo core (sem varrer de novo).
 */
export function ScanResults({ snapshot, filters }: { snapshot: ScanSnapshot; filters: ScanFilters }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('pass');
  const [mode, setMode] = useState<Mode>('tabela');
  const tf = snapshot.config.tf;
  const outcome = useMemo(
    () => new Map(snapshot.rows.map((r) => [r.symbolId, applyFilters(r.analysis, filters)])),
    [snapshot.rows, filters],
  );
  const groups: Record<Tab, ScanRow[]> = {
    pass: snapshot.rows.filter((r) => !r.error && outcome.get(r.symbolId)?.pass),
    chart: snapshot.rows.filter((r) => !r.error && outcome.get(r.symbolId)?.chartOnly),
    all: snapshot.rows,
    errors: snapshot.rows.filter((r) => r.error),
  };
  const tabs: { id: Tab; label: string }[] = [
    { id: 'pass', label: `Passaram (${groups.pass.length})` },
    ...(groups.chart.length || filters.fundamentals
      ? [{ id: 'chart' as const, label: `Só a parte gráfica (${groups.chart.length})` }]
      : []),
    { id: 'all', label: `Todos (${groups.all.length})` },
    ...(groups.errors.length ? [{ id: 'errors' as const, label: `Erros (${groups.errors.length})` }] : []),
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'pass';
  const rows = groups[current];
  const open = (id: string) => navigate(chartLink(id, tf));
  const simulated = snapshot.rows.some((r) => r.source?.simulated);

  return (
    <div className="space-y-2">
      {simulated && (
        <p className="rounded bg-warn/20 px-2 py-1 text-center text-xs font-bold tracking-wide text-warn">
          DADOS SIMULADOS
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <div role="tablist" aria-label="Grupos do resultado" className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={current === t.id}
              className={`rounded px-2 py-1 text-xs ${current === t.id ? 'bg-panel-2 text-text' : 'text-muted'}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1" role="group" aria-label="Forma de ver">
          {(['tabela', 'cartoes'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              className={`rounded border px-2 py-1 text-xs ${mode === m ? 'border-accent text-accent' : 'border-line text-muted'}`}
              onClick={() => setMode(m)}
            >
              {m === 'tabela' ? 'Tabela' : 'Cartões'}
            </button>
          ))}
        </div>
      </div>
      {current === 'chart' && (
        <p className="text-xs text-warn">
          Passam em tudo, menos nos fundamentos, que não puderam ser verificados (nenhuma fonte de
          fundamentos ligada ainda). Não é “aprovado”: confira o lucro e a receita por conta própria.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="rounded border border-line p-3 text-sm text-muted">
          {current === 'pass'
            ? 'Nenhum ativo passou em todos os filtros.'
            : 'Nada aqui.'}
        </p>
      ) : mode === 'tabela' ? (
        <Table rows={rows} outcome={outcome} tf={tf} open={open} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Cartões do resultado">
          {rows.map((r) => (
            <Card key={r.symbolId} r={r} outcome={outcome.get(r.symbolId)} tf={tf} open={open} />
          ))}
        </ul>
      )}
    </div>
  );
}
