import { compareJournals } from '@radar/core';
import {
  PAPER_EVENT_LABEL,
  REAL_MARKETS,
  formatBRL,
  formatDateTime,
  formatNumber,
  formatTrim,
  planMissing,
  type PaperStats,
  type RealMarket,
  type RealTrade,
  type TradePlan,
} from '@radar/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SmallSample, StatsGrid, TaxTable } from '../components/JournalStats';
import { PlanFields, emptyPlan } from '../components/PlanFields';
import { CalcResult, parseNum, sizeFor } from '../components/PositionCalculator';
import { SymbolSearch } from '../components/SymbolSearch';
import { ApiError, api } from '../lib/api';
import { usePaper } from '../lib/paper-store';
import { usePrefs } from '../lib/prefs';
import { useReal } from '../lib/real-store';
import { replayJournal } from '../lib/replay-store';

const card = 'rounded border border-line bg-panel p-3';
const field = 'w-full rounded border border-line bg-bg px-2 py-1 text-sm';
const btn = 'rounded border border-line px-2 py-1 text-xs hover:bg-panel-2 disabled:opacity-50';
const primary =
  'rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50';

/** "AAAA-MM-DDTHH:mm" no fuso do aparelho (campo datetime-local). */
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const fromLocalInput = (s: string) => (s ? new Date(s).getTime() : NaN);
const num = (x: number) => formatTrim(x);

function Input({
  label,
  value,
  onChange,
  hint,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  hint?: string;
  type?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted">{label}</span>
      <input
        className={field}
        type={type}
        inputMode={type === 'text' ? 'decimal' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

function NewTrade({ onDone }: { onDone(): void }) {
  const create = useReal((s) => s.create);
  const capital = usePrefs((s) => s.capital);
  const riskPct = usePrefs((s) => s.riskPct);
  const [market, setMarket] = useState<RealMarket>('b3-acao');
  const [symbol, setSymbol] = useState('');
  const [symbolId, setSymbolId] = useState<string | null>(null);
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [time, setTime] = useState(toLocalInput(Date.now()));
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [fees, setFees] = useState('');
  const [fx, setFx] = useState('');
  const [currency, setCurrency] = useState('');
  const [note, setNote] = useState('');
  const [plan, setPlan] = useState<TradePlan>(emptyPlan());
  const [usePlan, setUsePlan] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const m = REAL_MARKETS[market];
  const cur = (currency.trim() || m.currency).toUpperCase();
  const foreign = cur !== 'BRL';
  const v = {
    price: parseNum(price),
    qty: parseNum(qty),
    stop: parseNum(stop),
    target: parseNum(target),
    fees: parseNum(fees) ?? 0,
    fx: foreign ? parseNum(fx) : 1,
  };
  const sized =
    v.price !== null && v.stop !== null && v.fx !== null && v.fx > 0
      ? sizeFor({
          market,
          capitalBrl: capital,
          riskPct,
          entry: v.price,
          stop: v.stop,
          target: v.target,
          fx: v.fx,
        })
      : null;
  const missing = usePlan
    ? planMissing(plan, { stopLoss: v.stop, takeProfit: v.target, qty: v.qty })
    : ['plano'];
  const submit = async () => {
    setMsg(null);
    const t = fromLocalInput(time);
    if (!symbol.trim()) return setMsg('Informe o ativo.');
    if (v.price === null || v.price <= 0) return setMsg('Informe o preço de entrada.');
    if (v.qty === null || v.qty <= 0) return setMsg('Informe a quantidade.');
    if (!Number.isFinite(t)) return setMsg('Informe a data e a hora da execução.');
    if (foreign && (v.fx === null || v.fx <= 0))
      return setMsg(`Informe o câmbio (R$ por 1 ${cur}) do dia da execução.`);
    setBusy(true);
    try {
      await create({
        symbol: symbol.trim(),
        symbolId,
        market,
        side,
        currency: cur,
        pointValue: m.pointValue,
        initialStop: v.stop,
        target: v.target,
        entry: {
          time: t,
          kind: 'entrada',
          qty: v.qty,
          price: v.price,
          feesBrl: v.fees,
          fx: v.fx ?? 1,
        },
        note,
        plan: usePlan ? plan : null,
      });
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`${card} space-y-3`} aria-label="Registrar trade real">
      <h2 className="font-semibold">Registrar trade real</h2>
      <p className="text-xs text-muted">
        O Radar não envia ordens. Registre aqui o que você executou na corretora, com os valores da
        nota de corretagem.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 block text-xs">
          <span className="text-muted">Mercado</span>
          <select
            className={field}
            value={market}
            onChange={(e) => {
              setMarket(e.target.value as RealMarket);
              setCurrency('');
            }}
          >
            {Object.entries(REAL_MARKETS).map(([k, x]) => (
              <option key={k} value={k}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <div className="col-span-2 flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Ativo"
              value={symbol}
              onChange={(s) => {
                setSymbol(s);
                setSymbolId(null);
              }}
              hint="Ex.: PETR4, WINZ26, BTCUSDT, EURUSD"
            />
          </div>
          <SymbolSearch
            current={symbolId ?? ''}
            label="buscar"
            onPick={(id) => {
              setSymbolId(id);
              setSymbol(id.split(':')[1] ?? id);
            }}
          />
        </div>
        <div className="col-span-2 flex gap-1" role="group" aria-label="Lado">
          {(
            [
              ['long', 'Compra'],
              ['short', 'Venda (a descoberto)'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={side === k}
              onClick={() => setSide(k)}
              className={`rounded border px-2 py-1 text-xs ${side === k ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <Input
          label="Data e hora da execução"
          type="datetime-local"
          value={time}
          onChange={setTime}
        />
        <Input label={`Preço de entrada (${cur})`} value={price} onChange={setPrice} />
        <Input
          label={`Stop técnico (${cur})`}
          value={stop}
          onChange={setStop}
          hint="Onde a tese morre"
        />
        <Input label="Alvo (opcional)" value={target} onChange={setTarget} />
        <Input label={`Quantidade (${m.qtyLabel})`} value={qty} onChange={setQty} />
        <Input
          label="Custos da entrada (R$)"
          value={fees}
          onChange={setFees}
          hint="Corretagem e taxas"
        />
        {market === 'forex' && (
          <Input
            label="Moeda de cotação"
            value={currency}
            onChange={setCurrency}
            hint="EURUSD → USD; USDJPY → JPY"
          />
        )}
        {foreign && (
          <Input
            label={`Câmbio: R$ por 1 ${cur}`}
            value={fx}
            onChange={setFx}
            hint="Do dia da execução"
          />
        )}
      </div>
      {sized && sized.quantity > 0 && (
        <div className="rounded bg-bg p-2">
          <p className="mb-1 text-xs text-muted">
            Pelo seu risco de {formatNumber(riskPct, 1)}% de {formatBRL(capital)} (
            <Link to="/calculadora" className="text-accent underline">
              mudar
            </Link>
            ):
          </p>
          <CalcResult r={sized} market={market} showAllocated={false} />
          <button
            type="button"
            className={`${btn} mt-1`}
            onClick={() => setQty(String(sized.quantity))}
          >
            Usar esta quantidade
          </button>
          {v.qty !== null && v.qty > sized.quantity && (
            <p className="mt-1 text-xs text-warn">
              ⚠ A quantidade digitada passa do tamanho pelo seu risco.
            </p>
          )}
        </div>
      )}
      {sized?.warnings.map((w) => (
        <p key={w} className="text-xs text-warn">
          ⚠ {w}
        </p>
      ))}
      <label className="block text-xs">
        <span className="text-muted">Observações</span>
        <textarea
          className={field}
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <details open className="rounded border border-line p-2">
        <summary className="cursor-pointer text-sm">Plano de trade (conta na disciplina)</summary>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={!usePlan}
            onChange={(e) => setUsePlan(!e.target.checked)}
          />
          Entrei sem plano (fica registrado)
        </label>
        {usePlan && (
          <div className="mt-2">
            <PlanFields value={plan} onChange={setPlan} missing={missing} />
          </div>
        )}
      </details>
      {msg && (
        <p className="text-sm text-down" role="alert">
          {msg}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className={primary} disabled={busy} onClick={() => void submit()}>
          Registrar
        </button>
        <button type="button" className={btn} onClick={onDone}>
          Cancelar
        </button>
      </div>
    </section>
  );
}

function FillForm({
  t,
  kind,
  onDone,
}: {
  t: RealTrade;
  kind: 'entrada' | 'saida';
  onDone(): void;
}) {
  const addFill = useReal((s) => s.addFill);
  const [time, setTime] = useState(toLocalInput(Date.now()));
  const [qty, setQty] = useState(kind === 'saida' ? String(t.openQty) : '');
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('');
  const [fx, setFx] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const foreign = t.currency !== 'BRL';
  const submit = async () => {
    const q = parseNum(qty);
    const p = parseNum(price);
    const f = foreign ? parseNum(fx) : 1;
    if (!q || q <= 0 || !p || p <= 0) return setMsg('Informe quantidade e preço.');
    if (!f || f <= 0) return setMsg(`Informe o câmbio (R$ por 1 ${t.currency}).`);
    try {
      await addFill(t.id, {
        time: fromLocalInput(time),
        kind,
        qty: q,
        price: p,
        feesBrl: parseNum(fees) ?? 0,
        fx: f,
      });
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div
      className="mt-2 space-y-2 rounded bg-bg p-2"
      aria-label={kind === 'saida' ? 'Registrar saída' : 'Aumentar posição'}
    >
      <div className="grid grid-cols-2 gap-2">
        <Input label="Data e hora" type="datetime-local" value={time} onChange={setTime} />
        <Input
          label={`Quantidade${kind === 'saida' ? ` (aberta: ${num(t.openQty)})` : ''}`}
          value={qty}
          onChange={setQty}
        />
        <Input label={`Preço (${t.currency})`} value={price} onChange={setPrice} />
        <Input label="Custos (R$)" value={fees} onChange={setFees} />
        {foreign && <Input label={`Câmbio: R$ por 1 ${t.currency}`} value={fx} onChange={setFx} />}
      </div>
      {msg && <p className="text-xs text-down">{msg}</p>}
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={() => void submit()}>
          Salvar {kind === 'saida' ? 'saída' : 'entrada'}
        </button>
        <button type="button" className={btn} onClick={onDone}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function StopForm({ t, onDone }: { t: RealTrade; onDone(): void }) {
  const update = useReal((s) => s.update);
  const [stop, setStop] = useState(t.stop === null ? '' : String(t.stop));
  const [target, setTarget] = useState(t.target === null ? '' : String(t.target));
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async (confirmMovedBack = false) => {
    setMsg(null);
    const s = stop.trim() ? parseNum(stop) : null;
    const g = target.trim() ? parseNum(target) : null;
    try {
      await update(t.id, { stop: s, target: g, ...(confirmMovedBack ? { confirmMovedBack } : {}) });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (
          window.confirm(
            'Você está AFASTANDO o stop: o risco aumenta e isso fica registrado no diário como "stop movido para trás". Confirmar?',
          )
        )
          void submit(true);
        return;
      }
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="mt-2 space-y-2 rounded bg-bg p-2" aria-label="Mover stop">
      <div className="grid grid-cols-2 gap-2">
        <Input
          label={`Stop (${t.currency})`}
          value={stop}
          onChange={setStop}
          hint="Só anda a favor"
        />
        <Input label={`Alvo (${t.currency})`} value={target} onChange={setTarget} />
      </div>
      {t.avgEntry !== null && (
        <button type="button" className={btn} onClick={() => setStop(String(t.avgEntry))}>
          Stop no preço de entrada (breakeven)
        </button>
      )}
      {msg && <p className="text-xs text-down">{msg}</p>}
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={() => void submit()}>
          Salvar
        </button>
        <button type="button" className={btn} onClick={onDone}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Details({ t }: { t: RealTrade }) {
  const removeFill = useReal((s) => s.removeFill);
  const [err, setErr] = useState<string | null>(null);
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted">Execuções e eventos</summary>
      <ul className="mt-1 space-y-0.5">
        {t.fills.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2">
            <span>{formatDateTime(f.time)}</span>
            <span>{f.kind === 'entrada' ? 'Entrada' : 'Saída'}</span>
            <span>
              {num(f.qty)} × {num(f.price)} {t.currency}
            </span>
            {f.feesBrl > 0 && <span className="text-muted">custos {formatBRL(f.feesBrl)}</span>}
            {t.fills.length > 1 && (
              <button
                type="button"
                className="text-down underline"
                onClick={() => {
                  if (window.confirm('Apagar esta execução (digitada errado)?'))
                    removeFill(t.id, f.id).catch((e: Error) => setErr(e.message));
                }}
              >
                apagar
              </button>
            )}
          </li>
        ))}
      </ul>
      {err && <p className="text-down">{err}</p>}
      <ul className="mt-2 space-y-0.5 border-t border-line pt-1">
        {t.events.map((e) => (
          <li key={e.id} className={e.kind === 'stop-movido-para-tras' ? 'text-down' : ''}>
            {formatDateTime(e.time)} · {PAPER_EVENT_LABEL[e.kind]} · {e.detail}
          </li>
        ))}
      </ul>
      {t.plan && !t.plan.released && (
        <p className="mt-1 text-warn">
          Plano incompleto na entrada: faltava {t.plan.missing.join(', ')}.
        </p>
      )}
      {t.note && <p className="mt-1 text-muted">{t.note}</p>}
    </details>
  );
}

function OpenTrade({ t }: { t: RealTrade }) {
  const remove = useReal((s) => s.remove);
  const [mode, setMode] = useState<'saida' | 'entrada' | 'stop' | null>(null);
  return (
    <li className={card} data-testid="real-open">
      <div className="flex flex-wrap items-baseline gap-2">
        <b>{t.symbol}</b>
        <span className="text-xs text-muted">
          {t.side === 'long' ? 'Compra' : 'Venda'} · {REAL_MARKETS[t.market].label}
        </span>
        <span className="ml-auto text-xs">
          aberto: {num(t.openQty)} a {t.avgEntry === null ? '—' : num(t.avgEntry)} {t.currency}
        </span>
      </div>
      <p className="mt-1 text-xs">
        Stop: {t.stop === null ? <span className="text-down">sem stop</span> : num(t.stop)} · Alvo:{' '}
        {t.target === null ? '—' : num(t.target)}
        {t.initialRiskBrl !== null && <> · risco inicial {formatBRL(t.initialRiskBrl)}</>}
        {t.realizedBrl !== 0 && (
          <>
            {' '}
            · realizado{' '}
            <span className={t.realizedBrl >= 0 ? 'text-up' : 'text-down'}>
              {formatBRL(t.realizedBrl)}
            </span>
          </>
        )}
        {t.stopMovedBack && <span className="text-down"> · stop movido para trás</span>}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        <button type="button" className={btn} onClick={() => setMode('saida')}>
          Registrar saída / parcial
        </button>
        <button type="button" className={btn} onClick={() => setMode('stop')}>
          Mover stop / alvo
        </button>
        <button type="button" className={btn} onClick={() => setMode('entrada')}>
          Aumentar posição
        </button>
        <button
          type="button"
          className={`${btn} text-down`}
          onClick={() => {
            if (window.confirm(`Apagar o trade de ${t.symbol} do diário? Não dá para desfazer.`))
              void remove(t.id);
          }}
        >
          Apagar
        </button>
      </div>
      {(mode === 'saida' || mode === 'entrada') && (
        <FillForm t={t} kind={mode} onDone={() => setMode(null)} />
      )}
      {mode === 'stop' && <StopForm t={t} onDone={() => setMode(null)} />}
      <Details t={t} />
    </li>
  );
}

function ClosedTrade({ t }: { t: RealTrade }) {
  return (
    <li className="py-2 text-sm" data-testid="real-closed">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs text-muted">{t.closedAt ? formatDateTime(t.closedAt) : ''}</span>
        <b>{t.symbol}</b>
        <span className="text-xs text-muted">{t.side === 'long' ? 'compra' : 'venda'}</span>
        <span className={`ml-auto font-semibold ${t.realizedBrl >= 0 ? 'text-up' : 'text-down'}`}>
          {formatBRL(t.realizedBrl)}
        </span>
        <span className="w-14 text-right text-xs">
          {t.r === null ? 'sem R' : `${formatNumber(t.r, 2)}R`}
        </span>
      </div>
      <p className="text-[11px] text-muted">
        {!t.plan ? 'sem plano' : t.plan.released ? 'plano liberado' : 'plano incompleto'}
        {t.initialStop === null ? ' · sem stop' : ''}
        {t.stopMovedBack ? ' · stop movido para trás' : ''}
      </p>
      <Details t={t} />
    </li>
  );
}

function Compare({ real }: { real: PaperStats }) {
  const id = usePaper((s) => s.activeId());
  const loaded = usePaper((s) => s.loaded);
  const load = usePaper((s) => s.load);
  const [paper, setPaper] = useState<PaperStats | null>(null);
  const [replay, setReplay] = useState<PaperStats | null>(null);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  useEffect(() => {
    let alive = true;
    replayJournal()
      .then((j) => alive && setReplay(j.stats))
      .catch(() => alive && setReplay(null));
    if (id)
      api<{ stats: PaperStats }>(`/api/paper/accounts/${id}/journal?all=1`)
        .then((j) => alive && setPaper(j.stats))
        .catch(() => alive && setPaper(null));
    return () => {
      alive = false;
    };
  }, [id]);
  const cols = [
    ...(paper ? [{ label: 'treino ao vivo', head: 'Treino', stats: paper }] : []),
    ...(replay ? [{ label: 'replay', head: 'Replay', stats: replay }] : []),
    { label: 'real', head: 'Real', stats: real },
  ];
  if (cols.length < 2) return null;
  const f = (x: number | null, d = 2, suf = '') =>
    x === null ? '—' : `${formatNumber(x, d)}${suf}`;
  const rows: [string, (s: PaperStats) => string][] = [
    ['Trades', (s) => String(s.trades)],
    ['Acerto', (s) => f(s.winRate === null ? null : s.winRate * 100, 0, '%')],
    ['Média em R', (s) => f(s.avgR, 2, 'R')],
    ['Disciplina', (s) => f(s.disciplinePct, 0, '%')],
    ['Stop para trás', (s) => String(s.stopMovedBack)],
  ];
  const results = cols
    .filter((c) => c.label !== 'real')
    .map((c) => ({
      c,
      r: compareJournals({ label: c.label, stats: c.stats }, { label: 'real', stats: real }),
    }));
  const findings = results.flatMap((x) => x.r.findings);
  const enough = results.some((x) => x.r.enough);
  return (
    <section className={`${card} space-y-2`} aria-label="Treino × real">
      <h2 className="font-semibold">Treino × replay × real</h2>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted">
            <th />
            {cols.map((c) => (
              <th key={c.label}>{c.head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn]) => (
            <tr key={label}>
              <td className="text-muted">{label}</td>
              {cols.map((c) => (
                <td key={c.label}>{fn(c.stats)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!enough ? (
        <p className="text-xs text-muted">
          Para comparar com algum valor são precisos pelo menos 20 trades encerrados em cada lado.
        </p>
      ) : findings.length ? (
        <ul className="space-y-1 text-xs text-warn" role="alert">
          {findings.map((x) => (
            <li key={x}>⚠ {x}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-up">Sem diferença grande entre o treino e o real.</p>
      )}
    </section>
  );
}

/** Diário de trades reais (SPEC §13 e §11). */
export function RealJournalPage() {
  const { journal, error, load } = useReal();
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    void load();
  }, [load]);
  const open = journal?.trades.filter((t) => t.status === 'aberto') ?? [];
  const closed = (journal?.trades.filter((t) => t.status === 'fechado') ?? []).sort(
    (a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0),
  );
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Diário real</h1>
        {!adding && (
          <button type="button" className={`${primary} ml-auto`} onClick={() => setAdding(true)}>
            + Registrar trade
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        Trades feitos com dinheiro de verdade, na sua corretora. Separado do treino para comparar os
        dois.{' '}
        <Link to="/calculadora" className="text-accent underline">
          Calculadora de posição
        </Link>
      </p>
      {error && (
        <p className="text-sm text-down">
          Diário indisponível: {error}{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            Tentar de novo
          </button>
        </p>
      )}
      {adding && <NewTrade onDone={() => setAdding(false)} />}
      {journal && (
        <>
          <section aria-label="Trades abertos" className="space-y-2">
            <h2 className="font-semibold">Abertos ({open.length})</h2>
            {open.length === 0 && <p className="text-xs text-muted">Nenhum trade aberto.</p>}
            <ul className="space-y-2">
              {open.map((t) => (
                <OpenTrade key={t.id} t={t} />
              ))}
            </ul>
          </section>
          <section className={`${card} space-y-3`} aria-label="Estatísticas do real">
            <h2 className="font-semibold">Estatísticas</h2>
            <StatsGrid s={journal.stats} />
            <SmallSample n={journal.stats.trades} />
            <ul className="divide-y divide-line">
              {closed.map((t) => (
                <ClosedTrade key={t.id} t={t} />
              ))}
              {closed.length === 0 && (
                <li className="py-2 text-xs text-muted">Nenhum trade encerrado ainda.</li>
              )}
            </ul>
            <TaxTable
              tax={journal.tax}
              title="IR estimado (B3)"
              empty="Sem saídas de ações ou minicontratos da B3."
              note="Estimativa pela regra de 2026 (15% swing, 20% day trade, isenção de vendas até R$ 20 mil no swing de ações; minicontratos nunca isentos), com os custos que você digitou. Day trade = saída no mesmo dia de uma entrada. NÃO substitui o cálculo da corretora nem um contador. Cripto, ações dos EUA e forex ficam de fora."
            />
          </section>
          <Compare real={journal.stats} />
        </>
      )}
    </div>
  );
}
