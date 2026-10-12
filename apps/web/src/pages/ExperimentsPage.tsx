import {
  EXPERIMENTS,
  EXPERIMENT_IDS,
  UNIVERSES,
  formatDateTime,
  formatNumber,
  type ExperimentId,
  type ExperimentResult,
  type ExperimentRun,
  type PooledStats,
  type UniverseId,
  type VariantResult,
} from '@radar/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getSources } from '../lib/api';
import { useExperiments } from '../lib/experiments-store';

const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? '—' : `${formatNumber(v * 100, d)}%`;
const rr = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${formatNumber(v, 2)} R`;
const num = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? '—' : formatNumber(v, d);
const short = (id: string) => id.split(':')[1] ?? id;

function Table({ head, rows, label }: { head: string[]; rows: ReactNode[][]; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] text-left text-xs" aria-label={label}>
        <thead>
          <tr className="text-muted">
            {head.map((h) => (
              <th key={h} className="py-0.5 pr-2 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line/50">
              {r.map((c, j) => (
                <td key={j} className="py-0.5 pr-2 tabular-nums">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const statCells = (p: PooledStats) => [
  p.trades,
  pct(p.winRate, 0),
  rr(p.expectancyR),
  num(p.profitFactorR),
  p.sample,
];

function Variants({ r }: { r: Extract<ExperimentResult, { kind: 'variants' }> }) {
  const label = (k: string) => r.variants.find((v) => v.key === k)?.label ?? k;
  return (
    <div className="space-y-2">
      <Table
        label="Resultado por variante"
        head={[
          'Variante',
          'Trades',
          'Acerto',
          'Expectativa',
          'Fator de lucro',
          'Amostra',
          'Teste (30% finais)',
        ]}
        rows={r.variants.map((v) => [
          v.label,
          ...statCells(v.pooled),
          `${rr(v.test.expectancyR)} em ${v.test.trades}`,
        ])}
      />
      <ul className="space-y-1 text-sm" aria-label="Comparações">
        {r.comparisons.map((c) => (
          <li key={c.label}>
            <b>{c.label}</b>:{' '}
            {c.diffR === null ? (
              'amostra insuficiente para comparar'
            ) : (
              <>
                {c.diffR > 0 ? '+' : ''}
                {formatNumber(c.diffR, 2)} R por trade (t = {formatNumber(c.t!, 2)}){' '}
                <span className="text-muted">
                  {c.meaningful
                    ? '▲ maior que o barulho do acaso'
                    : '≈ dentro do barulho do acaso (não dá para afirmar diferença)'}
                </span>
              </>
            )}
            <span className="block text-xs text-muted">
              ({label(c.b)} contra {label(c.a)})
            </span>
          </li>
        ))}
      </ul>
      <PerSymbol variants={r.variants} />
    </div>
  );
}

function PerSymbol({ variants }: { variants: VariantResult[] }) {
  const symbols = variants[0]?.perSymbol.map((p) => p.symbolId) ?? [];
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">Por ativo</summary>
      <Table
        label="Resultado por ativo"
        head={['Ativo', ...variants.map((v) => v.label)]}
        rows={symbols.map((s) => [
          short(s),
          ...variants.map((v) => {
            const p = v.perSymbol.find((x) => x.symbolId === s);
            if (!p) return '—';
            if (p.error) return <span className="text-warn">⚠ {p.error}</span>;
            return `${rr(p.expectancyR)} (${p.trades})`;
          }),
        ])}
      />
    </details>
  );
}

function Tails({ r }: { r: Extract<ExperimentResult, { kind: 'tails' }> }) {
  return (
    <Table
      label="Fechamentos fora da banda por ativo"
      head={[
        'Ativo',
        'Fechamentos',
        'Fora (acima/abaixo)',
        'Por lado',
        'Curva normal',
        'Passeio aleatório',
        'Tocou a média',
      ]}
      rows={r.rows.map((x) =>
        x.error
          ? [short(x.symbolId), <span className="text-warn">⚠ {x.error}</span>, '', '', '', '', '']
          : [
              short(x.symbolId),
              x.closes,
              `${x.above} / ${x.below}`,
              pct(((x.rateAbove ?? 0) + (x.rateBelow ?? 0)) / 2, 2),
              pct(x.normalPerSide, 3),
              pct(x.randomWalkPerSide, 2),
              `${pct(x.backToMean?.rate, 0)} de ${x.backToMean?.events} em ${x.horizon} candles`,
            ],
      )}
    />
  );
}

function Costs({ r }: { r: Extract<ExperimentResult, { kind: 'costs' }> }) {
  return (
    <Table
      label="Custos em R por ativo e escala"
      head={[
        'Ativo',
        'Escala',
        'Tipo',
        'Stop típico',
        'Custo ida e volta',
        'Custo em R',
        'Sobra',
        'Depois do IR',
        'Acerto mínimo',
      ]}
      rows={r.rows.map((x) =>
        x.error
          ? [
              short(x.symbolId),
              x.tf,
              <span className="text-warn">⚠ {x.error}</span>,
              '',
              '',
              '',
              '',
              '',
              '',
            ]
          : [
              short(x.symbolId),
              x.tf,
              x.modality,
              pct(x.stopPct, 2),
              pct(x.roundTripPct, 3),
              rr(x.costR),
              rr(x.netR),
              x.taxRate === null ? 'IR não simulado' : rr(x.afterTaxR),
              pct(x.breakEvenWinRate, 1),
            ],
      )}
    />
  );
}

function Reflex({ r }: { r: Extract<ExperimentResult, { kind: 'reflexivity' }> }) {
  const s = r.setup;
  return (
    <div className="space-y-2">
      <Table
        label="Compra a −50% contra Reflexividade"
        head={['Estratégia', 'Compras', 'Retorno médio', 'Mediana', 'Acerto', 'Pior queda média']}
        rows={[
          [
            'Compra a −50% (segura 52 semanas, sem custos)',
            r.naive.buys,
            pct(r.naive.avgReturn),
            pct(r.naive.medianReturn),
            pct(r.naive.winRate, 0),
            pct(r.naive.avgWorst),
          ],
          [
            `Reflexividade (${rr(s.pooled.expectancyR)} por trade, com custos)`,
            s.pooled.trades,
            pct(s.avgReturn),
            '—',
            pct(s.pooled.winRate, 0),
            pct(r.setupAvgWorst),
          ],
        ]}
      />
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Por ativo</summary>
        <Table
          label="Por ativo"
          head={[
            'Ativo',
            'Compras a −50%',
            'Retorno médio',
            'Trades da Reflexividade',
            'Expectativa',
          ]}
          rows={r.naivePerSymbol.map((n) => {
            const p = s.perSymbol.find((x) => x.symbolId === n.symbolId);
            return n.error
              ? [short(n.symbolId), <span className="text-warn">⚠ {n.error}</span>, '', '', '']
              : [short(n.symbolId), n.buys, pct(n.avgReturn), p?.trades ?? 0, rr(p?.expectancyR)];
          })}
        />
      </details>
    </div>
  );
}

function Result({ run }: { run: ExperimentRun }) {
  if (run.status === 'running')
    return (
      <p className="text-sm text-accent" role="status">
        Rodando… {run.progress.done} de {run.progress.total} ativos (um por vez, respeitando os
        limites das fontes).
      </p>
    );
  if (run.status === 'error')
    return (
      <p className="text-sm text-down" role="alert">
        ✕ {run.error}
      </p>
    );
  const r = run.result;
  return (
    <div className="space-y-2" data-testid={`exp-result-${run.experimentId}`}>
      <p className="text-xs text-muted">
        Rodado em {formatDateTime(run.finishedAt ?? run.createdAt)} com {run.symbols.length}{' '}
        {run.symbols.length === 1 ? 'ativo' : 'ativos'}.
      </p>
      {run.summary && <p className="rounded bg-panel-2 p-2 text-sm">{run.summary}</p>}
      {r?.kind === 'variants' && <Variants r={r} />}
      {r?.kind === 'tails' && <Tails r={r} />}
      {r?.kind === 'costs' && <Costs r={r} />}
      {r?.kind === 'reflexivity' && <Reflex r={r} />}
      {run.dataNotes.length > 0 && (
        <ul
          className="list-disc space-y-0.5 pl-5 text-xs text-muted"
          aria-label="Avisos sobre os dados"
        >
          {run.dataNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({ id, simulated }: { id: ExperimentId; simulated: boolean }) {
  const info = EXPERIMENTS[id];
  const { latest, run } = useExperiments();
  const anyRunning = Object.values(latest).some((r) => r?.status === 'running');
  const current = latest[id];
  const [uni, setUni] = useState<UniverseId>(simulated ? 'sim' : info.universe);
  const [text, setText] = useState(UNIVERSES[simulated ? 'sim' : info.universe].symbols.join(' '));
  useEffect(() => {
    if (!simulated) return;
    setUni('sim');
    setText(UNIVERSES.sim.symbols.join(' '));
  }, [simulated]);
  const symbols = text.split(/[\s,;]+/).filter(Boolean);
  const presets: UniverseId[] = simulated
    ? ['sim', 'b3', 'cripto', 'eua']
    : ['b3', 'cripto', 'eua'];
  return (
    <section className="space-y-2 rounded border border-line p-3" aria-label={info.title}>
      <h2 className="font-semibold">{info.title}</h2>
      <p className="text-sm">
        <span className="text-muted">O vídeo afirma:</span> “{info.claim}”
      </p>
      <p className="text-sm">
        <span className="text-muted">Hipótese:</span> {info.hypothesis}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Método e limitações</summary>
        <p className="mt-1">{info.method}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
          {info.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
      <div className="space-y-1">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Conjunto de ativos">
          {presets.map((u) => (
            <button
              key={u}
              type="button"
              className={`rounded border px-2 py-0.5 text-xs ${uni === u ? 'border-accent text-accent' : 'border-line text-muted'}`}
              onClick={() => {
                setUni(u);
                setText(UNIVERSES[u].symbols.join(' '));
              }}
            >
              {UNIVERSES[u].label}
            </button>
          ))}
        </div>
        <label className="block text-xs text-muted">
          Ativos (código da fonte, separados por espaço; até 30)
          <textarea
            className="mt-0.5 w-full rounded border border-line bg-panel px-2 py-1 text-xs text-text"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={anyRunning || !symbols.length || symbols.length > 30}
        className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-bg disabled:opacity-50"
        onClick={() => void run(id, symbols)}
      >
        Rodar {id.toUpperCase()}
      </button>
      {current && <Result run={current} />}
    </section>
  );
}

/** Experimentos prontos "Verificar o youtuber" (SPEC §12.4). */
export function ExperimentsPage() {
  const { load, loaded, error } = useExperiments();
  const [simulated, setSimulated] = useState(false);
  useEffect(() => {
    if (!loaded) void load();
    void getSources()
      .then((s) => setSimulated(s.simulated))
      .catch(() => {});
  }, [loaded, load]);
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-3">
      <h1 className="text-xl font-semibold">Verificar o youtuber</h1>
      <p className="text-sm text-muted">
        Experimentos prontos que testam afirmações do vídeo com dados reais, custos e o mesmo
        detector do app. Cada um mostra hipótese, método, resultado e limitações. Resultado “dentro
        do barulho do acaso” quer dizer: com essa amostra não dá para afirmar diferença.{' '}
        <Link to="/laboratorio" className="text-accent underline">
          Voltar ao laboratório
        </Link>
      </p>
      {error && (
        <p role="alert" className="rounded border border-down p-2 text-sm text-down">
          {error}
        </p>
      )}
      {EXPERIMENT_IDS.map((id) => (
        <Card key={id} id={id} simulated={simulated} />
      ))}
    </div>
  );
}
