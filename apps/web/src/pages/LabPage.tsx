import { SETUP_LABEL, type SetupId } from '@radar/core';
import {
  SETUP_IDS,
  TIMEFRAMES,
  TIMEFRAME_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatSessionDate,
  isIntraday,
  type LabMetrics,
  type LabRun,
  type LabVerdict,
  type Timeframe,
} from '@radar/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HelpLink } from '../components/HelpLink';
import {
  EquityChart,
  PolarityBars,
  PolarityLegend,
  compact,
  type PolarityBar,
} from '../components/LabCharts';
import { SymbolSearch } from '../components/SymbolSearch';
import { useLab } from '../lib/lab-store';
import { usePrefs } from '../lib/prefs';

const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? '—' : `${formatNumber(v * 100, d)}%`;
const num = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? '—' : formatNumber(v, d);

/** Dinheiro na moeda do ativo (USDT e afins não são moedas ISO: vira "1.234,56 USDT"). */
function moneyOf(currency: string) {
  return (v: number) => {
    try {
      return formatMoney(v, currency);
    } catch {
      return `${formatNumber(v, 2)} ${currency}`;
    }
  };
}

const VERDICT: Record<LabVerdict, { icon: string; cls: string; title: string }> = {
  aprovado: { icon: '✓', cls: 'border-up text-up', title: 'Aprovado (com ressalvas)' },
  promissor: {
    icon: '◐',
    cls: 'border-accent text-accent',
    title: 'Promissor, ainda não aprovado',
  },
  'evidência fraca': { icon: '⚠', cls: 'border-warn text-warn', title: 'Evidência fraca' },
  inconclusivo: { icon: '?', cls: 'border-warn text-warn', title: 'Inconclusivo' },
  reprovado: { icon: '✕', cls: 'border-down text-down', title: 'Reprovado' },
};

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded border border-line bg-panel px-2.5 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Section({
  title,
  help,
  children,
}: {
  title: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-line p-3" aria-label={title}>
      <h2 className="mb-2 font-semibold">
        {title} {help}
      </h2>
      {children}
    </section>
  );
}

function Form() {
  const recent = usePrefs((s) => s.recent);
  const { running, run } = useLab();
  // a Biblioteca e o gráfico abrem o laboratório já com ativo/setup: /laboratorio?id=…&setup=…
  const [params] = useSearchParams();
  const qSetup = params.get('setup');
  const qTf = params.get('tf');
  const [symbolId, setSymbolId] = useState(params.get('id') ?? recent[0]?.id ?? 'binance:BTCUSDT');
  const [tf, setTf] = useState<Timeframe>(
    (TIMEFRAMES as readonly string[]).includes(qTf ?? '') ? (qTf as Timeframe) : '1d',
  );
  const [setups, setSetups] = useState<SetupId[]>(
    (SETUP_IDS as readonly string[]).includes(qSetup ?? '') ? [qSetup as SetupId] : ['s91'],
  );
  const [capital, setCapital] = useState(10_000);
  const [riskPct, setRiskPct] = useState(1);
  const [bars, setBars] = useState(2500);
  const [allowShort, setAllowShort] = useState(false);
  const toggle = (s: SetupId) =>
    setSetups((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]));
  return (
    <form
      className="space-y-3 rounded border border-line p-3"
      aria-label="Configurar teste"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ symbolId, tf, setups, capital, riskPct, bars, allowShort });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Ativo</span>
        <SymbolSearch current={symbolId} onPick={setSymbolId} />
        <label className="flex items-center gap-1 text-sm">
          <span className="text-muted">Tempo gráfico</span>
          <select
            className="rounded border border-line bg-panel px-1 py-1"
            value={tf}
            onChange={(e) => setTf(e.target.value as Timeframe)}
          >
            {TIMEFRAMES.map((t) => (
              <option key={t} value={t}>
                {TIMEFRAME_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm text-muted">Setups (sinais de um ou mais)</legend>
        <div className="flex flex-wrap gap-1.5">
          {SETUP_IDS.map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-sm ${
                setups.includes(s) ? 'border-accent bg-panel-2' : 'border-line'
              }`}
            >
              <input type="checkbox" checked={setups.includes(s)} onChange={() => toggle(s)} />
              {SETUP_LABEL[s]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-sm">
          <span className="block text-muted">Capital inicial</span>
          <input
            type="number"
            min={100}
            step={100}
            className="w-full rounded border border-line bg-panel px-2 py-1"
            value={capital}
            onChange={(e) => setCapital(Number(e.target.value))}
          />
        </label>
        <label className="text-sm">
          <span className="block text-muted">Risco por trade (%)</span>
          <input
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            className="w-full rounded border border-line bg-panel px-2 py-1"
            value={riskPct}
            onChange={(e) => setRiskPct(Number(e.target.value))}
          />
        </label>
        <label className="text-sm">
          <span className="block text-muted">Candles para trás</span>
          <input
            type="number"
            min={100}
            max={10_000}
            step={100}
            className="w-full rounded border border-line bg-panel px-2 py-1"
            value={bars}
            onChange={(e) => setBars(Number(e.target.value))}
          />
        </label>
        <label className="flex items-end gap-1.5 pb-1 text-sm">
          <input
            type="checkbox"
            checked={allowShort}
            onChange={(e) => setAllowShort(e.target.checked)}
          />
          <span>Incluir vendas (apostar na queda)</span>
        </label>
      </div>
      <p className="text-xs text-muted">
        Usa os candles reais da fonte do ativo, os custos padrão do mercado (taxas, spread e
        derrapagem) e o IR simulado na B3. 70% do período é o “treino” e os 30% finais são o teste
        fora da amostra. Toda execução fica registrada.
      </p>
      <button
        type="submit"
        disabled={running || !setups.length}
        className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
      >
        {running ? 'Rodando… (pode levar alguns segundos)' : 'Rodar teste'}
      </button>
    </form>
  );
}

function Verdict({ run }: { run: LabRun }) {
  const v = VERDICT[run.verdict.label];
  return (
    <section
      className={`rounded border-2 p-3 ${v.cls}`}
      aria-label="Veredito"
      data-testid="lab-verdict"
    >
      <p className="text-lg font-bold">
        <span aria-hidden>{v.icon}</span> {v.title}
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-text">
        {run.verdict.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Você já testou <b className="text-text">{run.attempts}</b>{' '}
        {run.attempts === 1 ? 'variação' : 'variações'} deste ativo com estes setups. Quanto mais
        variações, maior a chance de o melhor resultado ser sorte.
      </p>
    </section>
  );
}

function Benchmarks({ run }: { run: LabRun }) {
  const m = run.metrics;
  const strat = m.totalReturnAfterTax ?? m.totalReturn;
  const rows = [
    {
      label: m.tax !== null ? 'Estratégia (após custos e IR)' : 'Estratégia (após custos)',
      value: strat,
    },
    { label: 'CDI no mesmo período', value: run.cdi?.acc ?? null },
    { label: 'Comprar e segurar', value: run.buyHold },
  ];
  const best = Math.max(...rows.map((r) => r.value ?? -Infinity));
  return (
    <Section
      title="Comparação no mesmo período"
      help={<HelpLink slug="antes-de-arriscar-dinheiro" label="Ajuda: custo de oportunidade" />}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="lab-benchmarks">
        {rows.map((r) => (
          <Tile
            key={r.label}
            label={r.label}
            value={r.value === null ? '—' : pct(r.value)}
            sub={
              r.value === null
                ? 'sem dados do Banco Central'
                : r.value === best
                  ? '▲ o maior dos três'
                  : undefined
            }
          />
        ))}
      </div>
      {m.tax === null && (
        <p className="mt-2 text-xs text-muted">
          IR não simulado para este mercado: o resultado está antes do imposto.
        </p>
      )}
    </Section>
  );
}

function Kpis({ m, money }: { m: LabMetrics; money(v: number): string }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="lab-kpis">
      <Tile label="Trades" value={m.trades} sub={`amostra: ${m.sample}`} />
      <Tile label="Taxa de acerto" value={pct(m.winRate)} />
      <Tile label="Payoff" value={num(m.payoff)} sub="ganho médio ÷ perda média" />
      <Tile
        label="Expectativa"
        value={m.expectancyR === null ? '—' : `${num(m.expectancyR)} R`}
        sub={m.expectancy === null ? undefined : `${money(m.expectancy)} por trade`}
      />
      <Tile label="Fator de lucro" value={num(m.profitFactor)} />
      <Tile label="Retorno anualizado" value={pct(m.cagr)} sub="antes do IR" />
      <Tile
        label="Pior queda"
        value={m.maxDrawdown > 0 ? pct(-m.maxDrawdown) : pct(0)}
        sub={`maior período abaixo do topo: ${m.maxDrawdownDays} dias`}
      />
      <Tile label="Maior sequência de perdas" value={m.longestLosingStreak} />
      <Tile label="Tempo posicionado" value={pct(m.exposure, 0)} />
      <Tile label="Candles por trade" value={num(m.avgBarsInTrade, 1)} sub="média" />
      <Tile label="Meses positivos" value={pct(m.positiveMonths, 0)} />
      <Tile
        label="Custos pagos"
        value={money(m.fees)}
        sub={m.tax !== null ? `IR simulado: ${money(m.tax)}` : 'IR não simulado'}
      />
    </div>
  );
}

const fmtR = (v: number) => formatNumber(v, Number.isInteger(v) ? 0 : 1);

function rLabel(from: number, to: number) {
  if (!Number.isFinite(from)) return `menos de ${fmtR(to)} R`;
  if (!Number.isFinite(to)) return `${fmtR(from)} R ou mais`;
  return `de ${fmtR(from)} a ${fmtR(to)} R`;
}

function RDistribution({ run }: { run: LabRun }) {
  const total = run.rHistogram.reduce((s, b) => s + b.count, 0) || 1;
  const bars: PolarityBar[] = run.rHistogram.map((b) => ({
    key: String(b.from),
    // rótulo na borda esquerda de cada barra, só nos inteiros (cabe no celular)
    axis: Number.isFinite(b.from) && Number.isInteger(b.from) ? fmtR(b.from) : '',
    value: b.count,
    negative: b.to <= 0,
    tip: (
      <>
        <div className="text-muted">{rLabel(b.from, b.to)}</div>
        <div className="font-semibold">
          {b.count} {b.count === 1 ? 'trade' : 'trades'} ({pct(b.count / total, 0)})
        </div>
      </>
    ),
  }));
  return (
    <Section
      title="Distribuição dos resultados em R"
      help={<HelpLink slug="r-multiplo" label="Ajuda: R múltiplo" />}
    >
      <PolarityLegend gain="ganho (R ≥ 0)" loss="perda (R < 0)" />
      <PolarityBars
        bars={bars}
        label="Distribuição dos resultados em R"
        yFormat={(v) => formatNumber(v, 0)}
        integerTicks
        testId="r-histogram"
      />
      <p className="text-xs text-muted">
        1 R = o risco planejado do trade. Perto de −1 R são os stops; perdas maiores que −1 R vêm de
        gaps e derrapagem.
      </p>
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-muted">Ver como tabela</summary>
        <table className="mt-1 w-full text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-0.5">Faixa</th>
              <th>Trades</th>
            </tr>
          </thead>
          <tbody>
            {run.rHistogram.map((b) => (
              <tr key={b.from} className="border-t border-line/50">
                <td className="py-0.5">{rLabel(b.from, b.to)}</td>
                <td>{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Section>
  );
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthName = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1]}/${k.slice(0, 4)}`;

function Monthly({ run, money }: { run: LabRun; money(v: number): string }) {
  // todos os meses do primeiro ao último (meses sem trade = barra vazia), para o tempo ficar em escala
  const months = useMemo(() => {
    const sorted = [...run.monthly].sort((a, b) => a.month.localeCompare(b.month));
    if (!sorted.length) return [];
    const by = new Map(sorted.map((x) => [x.month, x.pnl]));
    const out: { month: string; pnl: number; empty: boolean }[] = [];
    let y = Number(sorted[0]!.month.slice(0, 4));
    let mo = Number(sorted[0]!.month.slice(5, 7));
    const last = sorted.at(-1)!.month;
    for (let k = 0; k < 1200; k++) {
      const key = `${y}-${String(mo).padStart(2, '0')}`;
      out.push({ month: key, pnl: by.get(key) ?? 0, empty: !by.has(key) });
      if (key === last) break;
      mo = mo === 12 ? 1 : mo + 1;
      if (mo === 1) y++;
    }
    return out;
  }, [run.monthly]);
  const years = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of months)
      if (!x.empty) m.set(x.month.slice(0, 4), (m.get(x.month.slice(0, 4)) ?? 0) + x.pnl);
    return [...m.entries()];
  }, [months]);
  if (!months.length) return null;
  // rótulo só no primeiro mês de cada ano (e no primeiro da série)
  const bars: PolarityBar[] = months.map((x, i) => ({
    key: x.month,
    axis:
      i === 0 || x.month.slice(0, 4) !== months[i - 1]!.month.slice(0, 4)
        ? x.month.slice(2, 4)
        : '',
    value: x.pnl,
    negative: x.pnl < 0,
    tip: (
      <>
        <div className="text-muted">{monthName(x.month)}</div>
        <div className="font-semibold">{x.empty ? 'sem trade encerrado' : money(x.pnl)}</div>
      </>
    ),
  }));
  return (
    <Section title="Resultado por mês e por ano">
      <PolarityLegend gain="mês com lucro" loss="mês com prejuízo" />
      <PolarityBars bars={bars} label="Resultado por mês" yFormat={compact} testId="monthly" />
      <p className="text-xs text-muted">
        Resultado pelo mês em que o trade foi encerrado; rótulos embaixo = ano (2 dígitos). Antes do
        IR.
      </p>
      <table className="mt-2 w-full text-left text-sm" aria-label="Resultado por ano">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-0.5">Ano</th>
            <th>Resultado (antes do IR)</th>
          </tr>
        </thead>
        <tbody>
          {years.map(([y, v]) => (
            <tr key={y} className="border-t border-line/50">
              <td className="py-0.5">{y}</td>
              <td className="tabular-nums">{money(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function TrainTest({ run }: { run: LabRun }) {
  const cols: [string, LabMetrics][] = [
    ['Treino', run.train],
    ['Teste (fora da amostra)', run.test],
  ];
  const rows: [string, (m: LabMetrics) => string][] = [
    ['Trades', (m) => String(m.trades)],
    ['Amostra', (m) => m.sample],
    ['Taxa de acerto', (m) => pct(m.winRate)],
    ['Expectativa', (m) => (m.expectancyR === null ? '—' : `${num(m.expectancyR)} R`)],
    ['Fator de lucro', (m) => num(m.profitFactor)],
    ['Payoff', (m) => num(m.payoff)],
  ];
  return (
    <Section title="Treino × teste fora da amostra">
      <p className="mb-1 text-xs text-muted">
        Corte em {formatDate(run.cut)}. Se só o treino é bom, o “acerto” foi ajuste ao passado.
      </p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-0.5" />
            {cols.map(([c]) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="border-t border-line/50">
              <td className="py-0.5 text-muted">{label}</td>
              {cols.map(([c, m]) => (
                <td key={c} className="tabular-nums">
                  {f(m)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function paramLabel(p: string) {
  const [setup, ...rest] = p.split('.');
  const name = SETUP_LABEL[setup as SetupId] ?? setup;
  const what = rest.join('.');
  const nice =
    what === 'exit.targetR'
      ? 'alvo em R'
      : what === 'bbStdDev'
        ? 'desvios da Bollinger'
        : what === 'minDrawdown'
          ? 'queda mínima'
          : what;
  return `${name}: ${nice}`;
}

function Sensitivity({ run }: { run: LabRun }) {
  if (!run.sensitivity.length) return null;
  return (
    <Section title="Mapa de sensibilidade">
      <p className="mb-2 text-xs text-muted">
        O mesmo teste mudando um número do setup. Platô (vizinhos parecidos) é mais confiável que um
        pico isolado.
      </p>
      {run.sensitivity.map((s) => (
        <div key={s.param} className="mb-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="text-left text-xs font-semibold">{paramLabel(s.param)}</caption>
            <thead>
              <tr className="text-xs text-muted">
                <th className="py-0.5">Valor</th>
                <th>Expectativa</th>
                <th>Trades</th>
              </tr>
            </thead>
            <tbody>
              {s.values.map((v) => (
                <tr key={v.value} className="border-t border-line/50">
                  <td className="py-0.5">{formatNumber(v.value, 1)}</td>
                  <td className="tabular-nums">
                    {v.expectancyR === null ? '—' : `${num(v.expectancyR)} R`}
                    {v.expectancyR !== null && (
                      <span className="ml-1 text-xs text-muted">
                        {v.expectancyR > 0 ? '▲' : '▼'}
                      </span>
                    )}
                  </td>
                  <td>{v.trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Section>
  );
}

function MonteCarlo({ run }: { run: LabRun }) {
  const mc = run.monteCarlo;
  if (!mc.runs) return null;
  return (
    <Section
      title="Monte Carlo: azar de sequência"
      help={<HelpLink slug="drawdown" label="Ajuda: drawdown" />}
    >
      <p className="text-sm">
        Os mesmos trades, embaralhados {formatNumber(mc.runs, 0)} vezes, com{' '}
        {num(run.input.riskPct, 1)}% de risco por trade:
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        <li>
          Pior queda típica: <b>{pct(mc.drawdown.p50)}</b>; em 1 de cada 20 sequências passa de{' '}
          <b>{pct(mc.drawdown.p95)}</b>.
        </li>
        <li>
          Resultado final: de <b>{pct(mc.finalReturn.p5)}</b> (5% piores) a{' '}
          <b>{pct(mc.finalReturn.p95)}</b> (5% melhores); mediana {pct(mc.finalReturn.p50)}.
        </li>
      </ul>
      <table className="mt-2 w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-0.5">Chance de, em algum momento, estar perdendo</th>
            <th>Probabilidade</th>
          </tr>
        </thead>
        <tbody>
          {mc.probLoss.map((p) => (
            <tr key={p.at} className="border-t border-line/50">
              <td className="py-0.5">{pct(p.at, 0)} ou mais do capital</td>
              <td className="tabular-nums">{pct(p.p, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Trades({ run, money }: { run: LabRun; money(v: number): string }) {
  const intraday = isIntraday(run.input.tf);
  const when = (t: number) => (intraday ? formatDateTime(t) : formatSessionDate(t));
  const list = [...run.trades].reverse();
  const skipped = Object.entries(run.skipped);
  return (
    <Section title={`Trades (${run.metrics.trades})`}>
      {skipped.length > 0 && (
        <p className="mb-2 text-xs text-muted">
          Sinais que não viraram trade: {skipped.map(([why, n]) => `${why} (${n})`).join('; ')}.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-muted">
          Ver {Math.min(list.length, 200)} mais recentes
        </summary>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead>
              <tr className="text-muted">
                <th className="py-0.5">Setup</th>
                <th>Entrada</th>
                <th>Saída</th>
                <th>Motivo</th>
                <th>R</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 200).map((t) => (
                <tr key={`${t.entryTime}-${t.setup}`} className="border-t border-line/50">
                  <td className="py-0.5">
                    {SETUP_LABEL[t.setup as SetupId] ?? t.setup}
                    {t.againstHigher && (
                      <span className="ml-1 text-down" title="contra a tendência maior">
                        ⚠
                      </span>
                    )}
                  </td>
                  <td>{when(t.entryTime)}</td>
                  <td>{when(t.exitTime)}</td>
                  <td>{t.exitKind}</td>
                  <td className="tabular-nums">{num(t.r)}</td>
                  <td className="tabular-nums">{money(t.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Section>
  );
}

function Result({ run }: { run: LabRun }) {
  const money = moneyOf(run.currency);
  const intraday = isIntraday(run.input.tf);
  const when = (t: number) => (intraday ? formatDateTime(t) : formatSessionDate(t));
  return (
    <div className="space-y-3" data-testid="lab-result">
      <p className="text-sm">
        <b>{run.symbol}</b> · {TIMEFRAME_LABEL[run.input.tf]} ·{' '}
        {run.input.setups.map((s) => SETUP_LABEL[s]).join(' + ')} · {when(run.from)} a{' '}
        {when(run.to)} ({formatNumber(run.bars, 0)} candles)
      </p>
      <Verdict run={run} />
      {run.dataNotes.length > 0 && (
        <ul
          className="space-y-1 rounded border border-line bg-panel-2 p-2 text-xs"
          aria-label="Avisos sobre os dados"
        >
          {run.dataNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <Benchmarks run={run} />
      {run.metrics.trades === 0 ? (
        <Trades run={run} money={money} />
      ) : (
        <TradeCharts run={run} money={money} />
      )}
      <p className="text-xs text-muted">
        Passado não garante futuro. Este teste usa o mesmo detector dos alertas, com entrada e saída
        no pior preço plausível (modelo conservador), mas não reproduz fila, liquidez nem notícias.
      </p>
    </div>
  );
}

function TradeCharts({ run, money }: { run: LabRun; money(v: number): string }) {
  return (
    <>
      <Kpis m={run.metrics} money={money} />
      <Section title="Curva de capital">
        <EquityChart points={run.equity} initial={run.input.capital} cut={run.cut} money={money} />
      </Section>
      <RDistribution run={run} />
      <TrainTest run={run} />
      <Sensitivity run={run} />
      <MonteCarlo run={run} />
      <Monthly run={run} money={money} />
      <Trades run={run} money={money} />
    </>
  );
}

function History() {
  const { history, loadHistory, open, current } = useLab();
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);
  if (!history.length) return null;
  return (
    <details className="rounded border border-line p-3 text-sm">
      <summary className="cursor-pointer font-semibold">
        Testes anteriores ({history.length})
      </summary>
      <ul className="mt-2 divide-y divide-line/50">
        {history.map((h) => (
          <li key={h.id}>
            <button
              className={`w-full py-1.5 text-left hover:bg-panel-2 ${current?.id === h.id ? 'text-accent' : ''}`}
              onClick={() => void open(h.id)}
            >
              <span className="block">
                {h.symbolId.split(':')[1] ?? h.symbolId} ·{' '}
                {TIMEFRAME_LABEL[h.tf as Timeframe] ?? h.tf} ·{' '}
                {h.setups.map((s) => SETUP_LABEL[s as SetupId] ?? s).join(' + ')}
              </span>
              <span className="block text-xs text-muted">
                {formatDateTime(h.createdAt)} · {h.trades} trades ·{' '}
                {h.expectancyR === null ? '—' : `${num(h.expectancyR)} R`} · {h.verdict}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Laboratório (SPEC §12): backtest honesto com custos, IR, CDI, comprar e segurar e antiautoengano. */
export function LabPage() {
  const { current, error, running } = useLab();
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-3">
      <h1 className="text-xl font-semibold">
        Laboratório <HelpLink slug="expectativa" label="Ajuda: expectativa" />
      </h1>
      <p className="text-sm text-muted">
        Teste um setup no passado real do ativo antes de usar dinheiro. O laboratório é cético de
        propósito: com poucos trades, sem teste fora da amostra ou perdendo para o CDI, ele não
        aprova.
      </p>
      <Form />
      {error && (
        <p role="alert" className="rounded border border-down p-2 text-sm text-down">
          {error}
        </p>
      )}
      {running && <p className="text-sm text-muted">Buscando candles e rodando o teste…</p>}
      {current && <Result run={current} />}
      <History />
    </div>
  );
}
