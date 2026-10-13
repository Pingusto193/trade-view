import { positionSize, riskPctWarnings, type ReplayTrade } from '@radar/core';
import {
  REPLAY_MIN_AHEAD,
  REPLAY_WARMUP,
  TIMEFRAMES,
  TIMEFRAME_LABEL,
  formatBRL,
  formatNumber,
  formatTrim,
  planMissing,
  type ReplayCreate,
  type Timeframe,
  type TradePlan,
} from '@radar/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChartView } from '../chart/ChartView';
import type { PaperLine } from '../chart/controller';
import type { LiveSeriesEvents } from '../chart/live-series';
import { chartScreenshot } from '../chart/registry';
import { HelpLink } from '../components/HelpLink';
import { PlanFields, emptyPlan } from '../components/PlanFields';
import { parseNum } from '../components/PositionCalculator';
import { SymbolSearch } from '../components/SymbolSearch';
import { TradeFeedbackPanel } from '../components/TradeFeedback';
import { ApiError } from '../lib/api';
import { usePrefs, usePreset } from '../lib/prefs';
import { ReplaySource, useReplay, type ReplayView } from '../lib/replay-store';

const card = 'rounded border border-line bg-panel p-3';
const field = 'w-full rounded border border-line bg-bg px-2 py-1 text-sm';
const btn = 'rounded border border-line px-2 py-1 text-xs hover:bg-panel-2 disabled:opacity-50';
const primary =
  'rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50';

function NewSession() {
  const { start, busy, error } = useReplay();
  const [mode, setMode] = useState<'sorteio' | 'escolha'>('sorteio');
  const [tf, setTf] = useState<Timeframe>('1d');
  const [symbolId, setSymbolId] = useState('');
  const [date, setDate] = useState('');
  const [capital, setCapital] = useState('10000');
  const [fx, setFx] = useState('');
  const submit = () => {
    const input: ReplayCreate = {
      mode,
      tf,
      capital: parseNum(capital) ?? 10_000,
      ...(mode === 'escolha' && symbolId ? { symbolId } : {}),
      ...(mode === 'escolha' && date ? { date: Date.parse(`${date}T00:00:00Z`) } : {}),
      ...(parseNum(fx) ? { fxManual: parseNum(fx) as number } : {}),
    };
    void start(input).catch(() => undefined);
  };
  return (
    <section className={`${card} space-y-3`} aria-label="Nova sessão de replay">
      <h2 className="font-semibold">Nova sessão</h2>
      <div className="flex gap-1" role="group" aria-label="Como escolher">
        {(
          [
            ['sorteio', 'Sortear ativo e data'],
            ['escolha', 'Escolher'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={mode === k}
            onClick={() => setMode(k)}
            className={`rounded border px-2 py-1 text-xs ${mode === k ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        {mode === 'sorteio'
          ? 'O ativo e as datas ficam escondidos até você encerrar, para não "lembrar" o que aconteceu.'
          : 'Sem data, o início é sorteado dentro do histórico da fonte.'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs">
          <span className="text-muted">Escala</span>
          <select className={field} value={tf} onChange={(e) => setTf(e.target.value as Timeframe)}>
            {TIMEFRAMES.map((t) => (
              <option key={t} value={t}>
                {TIMEFRAME_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="text-muted">Capital fictício</span>
          <input
            className={field}
            inputMode="decimal"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
          />
        </label>
        {mode === 'escolha' && (
          <>
            <div className="text-xs">
              <span className="block text-muted">Ativo</span>
              <SymbolSearch
                current={symbolId}
                label={symbolId ? undefined : 'escolher'}
                onPick={setSymbolId}
              />
            </div>
            <label className="block text-xs">
              <span className="text-muted">Começar em (opcional)</span>
              <input
                className={field}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="col-span-2 block text-xs">
          <span className="text-muted">
            Câmbio manual R$/US$ (só se faltar cotação para ativos em dólar)
          </span>
          <input
            className={field}
            inputMode="decimal"
            value={fx}
            onChange={(e) => setFx(e.target.value)}
          />
        </label>
      </div>
      <p className="text-[11px] text-muted">
        Precisa de {REPLAY_WARMUP} candles antes do início (para os indicadores) e{' '}
        {REPLAY_MIN_AHEAD} depois. Ativos em dólar usam o câmbio de hoje, fixo na sessão
        (simplificação: o da época era outro; o resultado em R não muda).
      </p>
      {error && (
        <p className="text-sm text-down" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={primary}
        disabled={busy || (mode === 'escolha' && !symbolId)}
        onClick={submit}
      >
        {busy ? 'Preparando…' : 'Começar'}
      </button>
    </section>
  );
}

function Sessions() {
  const { sessions, list, open, remove } = useReplay();
  useEffect(() => {
    void list();
  }, [list]);
  if (!sessions.length) return null;
  return (
    <section className={`${card} space-y-2`} aria-label="Sessões anteriores">
      <h2 className="font-semibold">Sessões</h2>
      <ul className="divide-y divide-line text-sm">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <b>{s.label}</b>
            <span className="text-xs text-muted">{TIMEFRAME_LABEL[s.tf]}</span>
            <span className="text-xs">{s.status === 'ativa' ? 'em andamento' : 'encerrada'}</span>
            <span className="text-xs text-muted">
              {s.trades} {s.trades === 1 ? 'trade' : 'trades'}
              {s.avgR !== null ? ` · ${formatNumber(s.avgR, 2)}R médio` : ''}
            </span>
            <span className="ml-auto flex gap-1">
              <button
                type="button"
                className={btn}
                onClick={() => void open(s.id).catch(() => undefined)}
              >
                {s.status === 'ativa' ? 'Continuar' : 'Ver'}
              </button>
              <button
                type="button"
                className={`${btn} text-down`}
                onClick={() => {
                  if (window.confirm('Apagar esta sessão de replay e os trades dela?'))
                    void remove(s.id);
                }}
              >
                Apagar
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Ticket({ v, chartKey }: { v: ReplayView; chartKey: string }) {
  const { order, busy } = useReplay();
  const riskPct = usePrefs((s) => s.riskPct);
  const maxRiskPct = usePrefs((s) => s.maxRiskPct);
  const [type, setType] = useState<'market' | 'limit' | 'stop'>('market');
  const [price, setPrice] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [qty, setQty] = useState('');
  const [plan, setPlan] = useState<TradePlan>(() => ({
    ...emptyPlan(),
    tfSetup: v.tf,
    tfTrigger: v.tf,
  }));
  const [msg, setMsg] = useState<string | null>(null);
  const last = v.candles.at(-1)?.close ?? null;
  const entry = type === 'market' ? last : parseNum(price);
  const stopV = parseNum(stop);
  const tgtV = parseNum(target);
  const m = v.meta;
  const sizing = useMemo(() => {
    if (entry === null || stopV === null || stopV >= entry) return null;
    try {
      return positionSize({
        capital: v.equity / v.book.fx,
        riskPct,
        entry,
        stop: stopV,
        ...(tgtV !== null ? { target: tgtV } : {}),
        lotSize: m.lotSize,
        minQty: m.minQty,
        qtyStep: m.qtyStep,
        pointValue: m.pointValue,
        fractional: m.market === 'b3',
      });
    } catch {
      return null;
    }
  }, [entry, stopV, tgtV, v.equity, v.book.fx, riskPct, m]);
  const q = parseNum(qty) ?? sizing?.quantity ?? null;
  const missing = planMissing(plan, { stopLoss: stopV, takeProfit: tgtV, qty: q });
  const warnings = [
    ...(stopV === null ? ['Sem stop: o trade não tem risco definido e não entra no R.'] : []),
    ...(sizing?.warnings ?? []),
    ...riskPctWarnings(riskPct, maxRiskPct),
  ];
  const submit = async () => {
    setMsg(null);
    if (!q || q <= 0) return setMsg('Informe a quantidade (ou o stop, para o cálculo pelo risco).');
    try {
      await order({
        side: 'buy',
        type,
        qty: q,
        price: type === 'market' ? null : parseNum(price),
        stop: stopV,
        target: tgtV,
        plan: { ...plan, warnings: warnings.slice(0, 20), screenshot: chartScreenshot(chartKey) },
      });
      setMsg(
        type === 'market'
          ? 'Ordem dada: executa na abertura do próximo candle.'
          : 'Ordem pendente: executa quando o preço chegar lá.',
      );
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <section className={`${card} space-y-2`} aria-label="Boleta do replay">
      <h2 className="font-semibold">Comprar</h2>
      <div className="flex gap-1" role="group" aria-label="Tipo de ordem">
        {(
          [
            ['market', 'A mercado'],
            ['limit', 'Limitada'],
            ['stop', 'Stop (rompimento)'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={type === k}
            onClick={() => setType(k)}
            className={`rounded border px-2 py-1 text-xs ${type === k ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {type !== 'market' && (
          <label className="block text-xs">
            <span className="text-muted">{type === 'limit' ? 'Preço limite' : 'Gatilho'}</span>
            <input
              className={field}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
        )}
        <label className="block text-xs">
          <span className="text-muted">Stop</span>
          <input
            className={field}
            inputMode="decimal"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted">Alvo</span>
          <input
            className={field}
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted">Quantidade</span>
          <input
            className={field}
            inputMode="decimal"
            value={qty}
            placeholder={sizing ? `${formatTrim(sizing.quantity)} pelo risco` : ''}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
      </div>
      {sizing && (
        <p className="text-xs text-muted">
          Pelo risco de {formatNumber(riskPct, 1)}%: {formatTrim(sizing.quantity)} · perda no stop{' '}
          {formatBRL(sizing.maxLoss * v.book.fx)}
          {sizing.rr !== null ? ` · ${formatNumber(sizing.rr, 2)}R no alvo` : ''}
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} className="text-xs text-warn">
          ⚠ {w}
        </p>
      ))}
      <details className="rounded border border-line p-2">
        <summary className="cursor-pointer text-sm">Plano (o print do gráfico vai sozinho)</summary>
        <div className="mt-2">
          <PlanFields
            value={plan}
            onChange={setPlan}
            missing={missing.filter((x) => x !== 'print do gráfico')}
          />
        </div>
      </details>
      {msg && <p className="text-xs">{msg}</p>}
      <button
        type="button"
        className={primary}
        disabled={busy || !!v.book.position || v.book.orders.some((o) => o.side === 'buy')}
        onClick={() => void submit()}
      >
        Comprar
      </button>
    </section>
  );
}

function Position({ v }: { v: ReplayView }) {
  const { move, order, cancel, busy } = useReplay();
  const p = v.book.position;
  const [stop, setStop] = useState(p?.stop?.toString() ?? '');
  const [target, setTarget] = useState(p?.target?.toString() ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setStop(p?.stop?.toString() ?? '');
    setTarget(p?.target?.toString() ?? '');
  }, [p?.id, p?.stop, p?.target]);
  const last = v.candles.at(-1);
  const save = async (confirmMovedBack = false) => {
    setMsg(null);
    try {
      await move({
        stop: stop.trim() ? parseNum(stop) : null,
        target: target.trim() ? parseNum(target) : null,
        ...(confirmMovedBack ? { confirmMovedBack } : {}),
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (
          window.confirm(
            'Você está AFASTANDO o stop: o risco aumenta e isso fica registrado como "stop movido para trás". Confirmar?',
          )
        )
          void save(true);
        return;
      }
      setMsg((e as Error).message);
    }
  };
  if (!p && !v.book.orders.length) return null;
  return (
    <section className={`${card} space-y-2`} aria-label="Posição do replay">
      {p && last && (
        <>
          <h2 className="font-semibold">Posição</h2>
          <p className="text-sm" data-testid="replay-position">
            {formatTrim(p.qty)} a {formatNumber(p.avgPrice, v.meta.priceDecimals)} · agora{' '}
            {formatNumber(last.close, v.meta.priceDecimals)} ·{' '}
            <span className={last.close >= p.avgPrice ? 'text-up' : 'text-down'}>
              {formatBRL((last.close - p.avgPrice) * p.qty * v.book.pointValue * v.book.fx)}
            </span>
            {p.stopMovedBack && <span className="text-down"> · stop movido para trás</span>}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs">
              <span className="text-muted">Stop (só a favor)</span>
              <input
                className={field}
                inputMode="decimal"
                value={stop}
                onChange={(e) => setStop(e.target.value)}
              />
            </label>
            <label className="block text-xs">
              <span className="text-muted">Alvo</span>
              <input
                className={field}
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={btn} disabled={busy} onClick={() => void save()}>
              Salvar stop/alvo
            </button>
            <button type="button" className={btn} onClick={() => setStop(String(p.avgPrice))}>
              Stop no preço de entrada
            </button>
            <button
              type="button"
              className={btn}
              disabled={busy || v.book.orders.some((o) => o.side === 'sell')}
              onClick={() =>
                void order({
                  side: 'sell',
                  type: 'market',
                  qty: p.qty,
                  price: null,
                  stop: null,
                  target: null,
                  plan: null,
                }).catch((e: Error) => setMsg(e.message))
              }
            >
              Vender tudo (próxima abertura)
            </button>
          </div>
        </>
      )}
      {v.book.orders.length > 0 && (
        <ul className="space-y-1 text-xs" aria-label="Ordens pendentes">
          {v.book.orders.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              <span>
                {o.side === 'buy' ? 'Compra' : 'Venda'}{' '}
                {o.type === 'market'
                  ? 'a mercado (próxima abertura)'
                  : o.type === 'limit'
                    ? 'limitada'
                    : 'stop'}{' '}
                {formatTrim(o.qty)}
                {o.price !== null ? ` a ${o.price}` : ''}
              </span>
              <button
                type="button"
                className="text-down underline"
                onClick={() => void cancel(o.id)}
              >
                cancelar
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-xs text-down">{msg}</p>}
    </section>
  );
}

function Trades({ v }: { v: ReplayView }) {
  const [open, setOpen] = useState<string | null>(null);
  const t = v.book.trades;
  if (!t.length) return null;
  return (
    <section className={`${card} space-y-2`} aria-label="Trades do replay">
      <h2 className="font-semibold">Trades desta sessão</h2>
      <ul className="divide-y divide-line text-sm">
        {[...t].reverse().map((x: ReplayTrade) => (
          <li key={x.id} className="py-1.5" data-testid="replay-trade">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">
                {x.exitKind === 'stop' ? 'stop' : x.exitKind === 'alvo' ? 'alvo' : 'saída manual'}
              </span>
              <span className={`font-semibold ${x.realizedBrl >= 0 ? 'text-up' : 'text-down'}`}>
                {formatBRL(x.realizedBrl)}
              </span>
              <span className="text-xs">{x.r === null ? 'sem R' : `${formatNumber(x.r, 2)}R`}</span>
              <button
                type="button"
                className={`${btn} ml-auto`}
                onClick={() => setOpen(open === x.id ? null : x.id)}
              >
                {open === x.id ? 'Fechar feedback' : 'Ver feedback'}
              </button>
            </div>
            {open === x.id && (
              <TradeFeedbackPanel
                positionId={x.id}
                realR={x.r}
                url={`/api/replay/sessions/${v.id}/trades/${x.id}/feedback`}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Session({ v }: { v: ReplayView }) {
  const { advance, end, close, busy, error } = useReplay();
  const prefs = usePrefs();
  const preset = usePreset();
  const chartId = `replay:${v.id}`;
  // estável por sessão: trocar a fonte recriaria o gráfico
  const source = useCallback(
    (ev: LiveSeriesEvents) => new ReplaySource(() => useReplay.getState().view, ev),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v.id, v.status],
  );
  const lines = useMemo<PaperLine[]>(() => {
    const out: PaperLine[] = [];
    const p = v.book.position;
    if (p) {
      out.push({ price: p.avgPrice, title: `Replay ${formatTrim(p.qty)}`, kind: 'entry' });
      if (p.stop !== null) out.push({ price: p.stop, title: 'Stop', kind: 'stop' });
      if (p.target !== null) out.push({ price: p.target, title: 'Alvo', kind: 'target' });
    }
    for (const o of v.book.orders)
      if (o.price !== null)
        out.push({
          price: o.price,
          title: `Compra ${o.type === 'limit' ? 'lim.' : 'stop'}`,
          kind: 'order',
        });
    return out;
  }, [v.book.position, v.book.orders]);
  const active = v.status === 'ativa';
  const step = useCallback((n: number) => void advance(n).catch(() => undefined), [advance]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight' || e.key === 'n') {
        e.preventDefault();
        step(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, step]);
  const done = v.cursor - v.startIndex;
  const total = v.total - v.startIndex;
  const result = v.equity - v.book.initialBalance;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={close}>
          ← Sessões
        </button>
        <h1 className="text-lg font-semibold" data-testid="replay-symbol">
          {v.symbol}
        </h1>
        <span className="text-xs text-muted">{TIMEFRAME_LABEL[v.tf]}</span>
        <span className="text-xs" data-testid="replay-progress">
          candle {done} de {total}
        </span>
        <span className={`ml-auto text-sm ${result >= 0 ? 'text-up' : 'text-down'}`}>
          {formatBRL(v.equity)} ({result >= 0 ? '+' : ''}
          {formatBRL(result)})
        </span>
      </div>
      <div className="h-[55vh] min-h-[320px] overflow-hidden rounded border border-line">
        <ChartView
          id={chartId}
          tf={v.tf}
          preset={preset}
          chartType={prefs.chartType}
          upColor={prefs.upColor}
          downColor={prefs.downColor}
          source={source}
          drawingKey={chartId}
          paperLines={lines}
          hideTime={v.hidden && active}
          banner={
            <span className="rounded bg-train/20 px-1.5 py-0.5 text-[10px] font-bold text-train">
              REPLAY — DINHEIRO FICTÍCIO
            </span>
          }
        />
      </div>
      {active ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Avançar">
          <button type="button" className={primary} disabled={busy} onClick={() => step(1)}>
            Próximo candle ▶
          </button>
          <button type="button" className={btn} disabled={busy} onClick={() => step(5)}>
            +5
          </button>
          <button type="button" className={btn} disabled={busy} onClick={() => step(20)}>
            +20
          </button>
          <button
            type="button"
            className={`${btn} ml-auto`}
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'Encerrar o replay? A posição aberta é vendida no último fechamento e o ativo é revelado.',
                )
              )
                void end().catch(() => undefined);
            }}
          >
            Encerrar e revelar
          </button>
          <span className="w-full text-[11px] text-muted">
            Atalho: seta → ou a tecla N. Ordem a mercado executa na abertura do próximo candle.
          </span>
        </div>
      ) : (
        <p className="rounded bg-panel-2 p-2 text-sm" data-testid="replay-ended">
          Sessão encerrada. {v.hidden ? `O ativo era ${v.symbol}.` : ''}
        </p>
      )}
      {error && (
        <p className="text-sm text-down" role="alert">
          {error}
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {active && (
          <Ticket key={`${v.id}-${v.book.trades.length}`} v={v} chartKey={`${chartId}|${v.tf}`} />
        )}
        <Position v={v} />
      </div>
      <Trades v={v} />
      {v.book.events.length > 0 && (
        <details className={card}>
          <summary className="cursor-pointer text-sm">
            Histórico da sessão ({v.book.events.length})
          </summary>
          <ul className="mt-1 space-y-0.5 text-xs">
            {[...v.book.events].reverse().map((e, i) => (
              <li key={i} className={e.kind === 'stop-movido-para-tras' ? 'text-down' : ''}>
                {e.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Replay (SPEC §13): treinar no passado, candle a candle, com o futuro escondido. */
export function ReplayPage() {
  const view = useReplay((s) => s.view);
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3">
      {view ? (
        <Session key={view.id} v={view} />
      ) : (
        <>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            Replay
            <HelpLink slug="psicologia" label="Ajuda: treino e psicologia" />
          </h1>
          <p className="text-xs text-muted">
            Volte a um ponto do passado e avance candle a candle. O futuro fica guardado no
            servidor: só aparece quando você avança. As compras usam as mesmas regras do treino
            (custos, derrapagem, stop antes do alvo no mesmo candle).
          </p>
          <NewSession />
          <Sessions />
        </>
      )}
    </div>
  );
}
