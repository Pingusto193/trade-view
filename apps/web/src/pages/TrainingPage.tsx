import { DEFAULT_COSTS } from '@radar/core';
import {
  MARKET_LABEL,
  PAPER_EVENT_LABEL,
  formatBRL,
  formatDateTime,
  formatNumber,
  formatPercent,
  type Market,
  type PaperPosition,
} from '@radar/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpLink } from '../components/HelpLink';
import { usePaper } from '../lib/paper-store';
import { usePrefs } from '../lib/prefs';

const card = 'rounded border border-line bg-panel p-3';
const input = 'rounded border border-line bg-bg px-2 py-1 text-sm';

function NewAccount({ first }: { first: boolean }) {
  const [name, setName] = useState(first ? 'Meu treino' : 'Outra estratégia');
  const [amount, setAmount] = useState(10_000);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className={`${card} space-y-2`}
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        try {
          await usePaper.getState().createAccount(name, amount);
        } catch (x) {
          setErr((x as Error).message);
        }
      }}
    >
      <h2 className="font-semibold">
        {first ? 'Crie sua conta de treino' : 'Nova conta de treino'}
      </h2>
      <p className="text-xs text-muted">
        Dinheiro fictício, preços reais. Escolha quanto quer ter para treinar: o ideal é um valor
        parecido com o que você teria de verdade, para o treino ensinar a escala certa de risco.
      </p>
      <label className="block text-sm">
        Nome
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${input} mt-1 w-full`}
        />
      </label>
      <label className="block text-sm">
        Dinheiro fictício inicial (R$)
        <input
          type="number"
          min={100}
          step={100}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className={`${input} mt-1 w-full`}
          aria-label="Dinheiro fictício inicial"
        />
      </label>
      {err && <p className="text-xs text-down">{err}</p>}
      <button className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black">
        Criar conta
      </button>
    </form>
  );
}

function AccountSettings() {
  const st = usePaper((s) => s.state);
  const [amount, setAmount] = useState<number | null>(null);
  const [fx, setFx] = useState<string>('');
  const [msg, setMsg] = useState<string | null>(null);
  if (!st) return null;
  const a = st.account;
  return (
    <details className={card}>
      <summary className="cursor-pointer text-sm font-semibold">⚙ Conta, saldo e custos</summary>
      <div className="mt-3 space-y-4 text-sm">
        <div>
          <p className="font-medium">Mudar o dinheiro fictício</p>
          <p className="text-xs text-muted">
            Reinicia a conta com o novo valor. Posições abertas são encerradas pelo último preço e
            ordens pendentes são canceladas. O histórico continua salvo (veja “todas as fases” no
            diário).
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              type="number"
              min={100}
              step={100}
              value={amount ?? a.initialBalance}
              onChange={(e) => setAmount(Number(e.target.value))}
              className={`${input} w-40`}
              aria-label="Novo saldo"
            />
            <button
              className="rounded border border-warn px-2 text-xs text-warn"
              onClick={async () => {
                const v = amount ?? a.initialBalance;
                if (!window.confirm(`Reiniciar "${a.name}" com ${formatBRL(v)}?`)) return;
                try {
                  await usePaper.getState().reset(a.id, v);
                  setMsg('Conta reiniciada.');
                } catch (e) {
                  setMsg((e as Error).message);
                }
              }}
            >
              Reiniciar com este valor
            </button>
          </div>
        </div>
        <div>
          <p className="font-medium">Cotação manual do dólar (reserva)</p>
          <p className="text-xs text-muted">
            Ativos em dólar usam a cotação ao vivo de USDT/BRL da Binance (aproximação do dólar). Se
            ela faltar, usa este valor. Atual: {a.fxManual ? formatNumber(a.fxManual, 4) : '—'}
            {st.fx && st.fx !== 1 ? ` · ao vivo: ${formatNumber(st.fx, 4)}` : ''}
          </p>
          <div className="mt-1 flex gap-2">
            <input
              value={fx}
              onChange={(e) => setFx(e.target.value)}
              placeholder="ex.: 5,40"
              className={`${input} w-28`}
              aria-label="Cotação manual do dólar"
            />
            <button
              className="rounded border border-line px-2 text-xs"
              onClick={async () => {
                const v = Number(fx.replace(',', '.'));
                await usePaper
                  .getState()
                  .updateAccount(a.id, { fxManual: Number.isFinite(v) && v > 0 ? v : null });
                setMsg('Cotação salva.');
              }}
            >
              Salvar
            </button>
          </div>
        </div>
        <div>
          <p className="font-medium">
            Custos usados no treino <HelpLink slug="slippage-e-custos" label="Ajuda: custos" />
          </p>
          <p className="text-xs text-muted">
            Padrões aproximados (confira com a sua corretora). Custos zerados fazem o treino parecer
            melhor do que o real.
          </p>
          <table className="mt-1 w-full text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th>Mercado</th>
                <th>Taxa %</th>
                <th>Corretagem</th>
                <th>Derrapagem (ticks)</th>
                <th>Spread %</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(DEFAULT_COSTS) as Market[]).map((m) => {
                const c = a.costs[m] ?? DEFAULT_COSTS[m];
                return (
                  <tr key={m}>
                    <td>{MARKET_LABEL[m]}</td>
                    <td>{formatNumber(c.feePct * 100, 3)}</td>
                    <td>{formatNumber(c.commissionPerOrder, 2)}</td>
                    <td>{c.slippageTicks}</td>
                    <td>{formatNumber(c.spreadPct * 100, 3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {msg && <p className="text-xs text-muted">{msg}</p>}
      </div>
    </details>
  );
}

function PositionRow({ p }: { p: PaperPosition }) {
  const [stop, setStop] = useState(p.stop?.toString() ?? '');
  const [target, setTarget] = useState(p.target?.toString() ?? '');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    const s = stop ? Number(stop.replace(',', '.')) : null;
    const t = target ? Number(target.replace(',', '.')) : null;
    try {
      await usePaper.getState().updatePosition(p.id, { stop: s, target: t });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('Confirme') && window.confirm(`${msg}\n\nAfastar mesmo assim?`)) {
        await usePaper
          .getState()
          .updatePosition(p.id, { stop: s, target: t, confirmBackward: true })
          .catch((x: Error) => setErr(x.message));
      } else setErr(msg);
    }
  };
  const tone = (p.unrealizedBrl ?? 0) >= 0 ? 'text-up' : 'text-down';
  return (
    <li className="space-y-1 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3">
        <Link to={`/grafico?id=${encodeURIComponent(p.symbolId)}&tf=1d`} className="font-semibold">
          {p.symbolId.split(':')[1]}
        </Link>
        <span>
          {formatNumber(p.qty, p.qty % 1 ? 6 : 0)} × {formatNumber(p.avgPrice, 2)} {p.currency}
        </span>
        <span className="text-muted">
          último {p.lastPrice ? formatNumber(p.lastPrice, 2) : '—'}
        </span>
        <b className={tone}>{p.unrealizedBrl === null ? '—' : formatBRL(p.unrealizedBrl)}</b>
        <button
          className="ml-auto rounded border border-line px-2 text-xs"
          onClick={async () => {
            if (!window.confirm('Vender tudo a mercado (preço real + custos)?')) return;
            await usePaper
              .getState()
              .order({
                symbolId: p.symbolId,
                side: 'sell',
                type: 'market',
                qty: p.qty,
                price: null,
                stopLoss: null,
                takeProfit: null,
                note: 'encerrada pela tela de treino',
              })
              .catch((e: Error) => setErr(e.message));
          }}
        >
          Encerrar
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          Stop
          <input
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            className={`${input} w-24 py-0.5 text-xs`}
            aria-label={`Stop de ${p.symbolId}`}
          />
        </label>
        <label className="flex items-center gap-1">
          Alvo
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={`${input} w-24 py-0.5 text-xs`}
            aria-label={`Alvo de ${p.symbolId}`}
          />
        </label>
        <button className="rounded border border-line px-2" onClick={() => void save()}>
          Salvar
        </button>
        {p.stop === null && <span className="text-warn">⚠ sem stop</span>}
      </div>
      {p.delayNote && <p className="text-[11px] text-muted">{p.delayNote}</p>}
      {err && <p className="text-xs text-down">{err}</p>}
    </li>
  );
}

function Journal() {
  const { journal, loadJournal } = usePaper();
  const [all, setAll] = useState(false);
  useEffect(() => {
    void loadJournal(all);
  }, [loadJournal, all]);
  if (!journal) return null;
  const s = journal.stats;
  const small = s.trades < 30;
  return (
    <section className={`${card} space-y-3`} aria-label="Diário do treino">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Diário e estatísticas</h2>
        <label className="ml-auto flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          todas as fases (antes dos reinícios)
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Trades" value={String(s.trades)} />
        <Stat label="Acerto" value={s.winRate === null ? '—' : formatPercent(s.winRate, 0)} />
        <Stat label="Média em R" value={s.avgR === null ? '—' : `${formatNumber(s.avgR, 2)}R`} />
        <Stat
          label="Resultado"
          value={formatBRL(s.totalBrl)}
          tone={s.totalBrl >= 0 ? 'up' : 'down'}
        />
        <Stat label="Custos pagos" value={formatBRL(s.feesBrl)} />
        <Stat
          label="Pior queda"
          value={`${formatBRL(s.maxDrawdownBrl)} (${formatNumber(s.maxDrawdownPct, 1)}%)`}
        />
        <Stat
          label="Sem stop"
          value={String(s.withoutStop)}
          tone={s.withoutStop ? 'down' : undefined}
        />
        <Stat
          label="Stop para trás"
          value={String(s.stopMovedBack)}
          tone={s.stopMovedBack ? 'down' : undefined}
        />
      </div>
      {small && (
        <p className="rounded bg-warn/15 p-2 text-xs text-warn">
          Amostra pequena ({s.trades} trades): com menos de 30 o resultado é inconclusivo e com
          menos de 100 é evidência fraca. Sorte e azar ainda dominam.{' '}
          <HelpLink
            slug="expectativa"
            label="Ajuda: expectativa e amostra"
            className="align-middle"
          />
        </p>
      )}
      <ul className="divide-y divide-line text-sm">
        {journal.trades.map((t) => (
          <li key={t.id} className="flex flex-wrap gap-x-3 py-1.5">
            <span className="font-medium">{t.symbolId.split(':')[1]}</span>
            <span className="text-muted">
              {formatDateTime(t.openedAt)} → {t.closedAt ? formatDateTime(t.closedAt) : '—'}
            </span>
            <b className={t.realizedBrl >= 0 ? 'text-up' : 'text-down'}>
              {formatBRL(t.realizedBrl)}
            </b>
            <span>{t.r === null ? 'R —' : `${formatNumber(t.r, 2)}R`}</span>
            <span className="text-muted">custos {formatBRL(t.feesBrl)}</span>
          </li>
        ))}
        {journal.trades.length === 0 && (
          <li className="py-2 text-xs text-muted">Nenhum trade encerrado ainda.</li>
        )}
      </ul>
      <div>
        <h3 className="text-sm font-semibold">IR simulado (B3)</h3>
        {journal.tax.length === 0 ? (
          <p className="text-xs text-muted">Sem operações da B3 encerradas.</p>
        ) : (
          <table className="mt-1 w-full text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th>Mês</th>
                <th>Swing</th>
                <th>Day trade</th>
                <th>DARF</th>
              </tr>
            </thead>
            <tbody>
              {journal.tax.map((m) => (
                <tr key={m.month}>
                  <td>{m.month.split('-').reverse().join('/')}</td>
                  <td>
                    {formatBRL(m.swing.result)}
                    {m.exemptMonth ? ' (isento)' : ''}
                  </td>
                  <td>{formatBRL(m.day.result)}</td>
                  <td>{m.darf ? formatBRL(m.darf) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-1 text-[11px] text-muted">
          Simulação da regra de 2026 (15% swing, 20% day trade, isenção de vendas até R$ 20 mil no
          swing de ações). Não substitui um contador. Cripto e ações dos EUA têm regras próprias que
          ainda não são simuladas.
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded bg-bg p-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p
        className={`font-semibold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

/** Modo Treino (SPEC §13): dinheiro fictício, preços reais, execução pelo servidor. */
export function TrainingPage() {
  const { accounts, loaded, state, load, refresh, error } = usePaper();
  const setPaperAccount = usePrefs((s) => s.setPaperAccount);
  useEffect(() => {
    void load();
    // preço ao vivo das posições abertas
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void usePaper.getState().refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (!loaded) return <p className="p-3 text-sm text-muted">Carregando…</p>;
  if (accounts.length === 0)
    return (
      <div className="mx-auto max-w-xl p-3">
        <NewAccount first />
      </div>
    );
  const a = state?.account;
  const pnl = state && a ? state.equity - a.initialBalance : 0;
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={usePaper.getState().activeId() ?? ''}
          onChange={(e) => {
            setPaperAccount(e.target.value);
            void refresh();
          }}
          className={input}
          aria-label="Conta de treino"
        >
          {accounts.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <Link to="/grafico" className="text-xs text-accent underline">
          Abrir o gráfico para operar
        </Link>
      </div>
      {error && <p className="text-sm text-down">{error}</p>}
      {state && a && (
        <section className={`${card} grid grid-cols-2 gap-2 sm:grid-cols-4`} aria-label="Resumo">
          <Stat label="Dinheiro fictício inicial" value={formatBRL(a.initialBalance)} />
          <Stat label="Saldo em caixa" value={formatBRL(state.account.cash)} />
          <Stat label="Patrimônio" value={formatBRL(state.equity)} />
          <Stat
            label="Resultado"
            value={`${formatBRL(pnl)} (${formatNumber((pnl / a.initialBalance) * 100, 2)}%)`}
            tone={pnl >= 0 ? 'up' : 'down'}
          />
        </section>
      )}
      <AccountSettings />
      <section className={card} aria-label="Posições abertas">
        <h2 className="font-semibold">Posições abertas</h2>
        {state?.positions.length ? (
          <ul className="divide-y divide-line">
            {state.positions.map((p) => (
              <PositionRow key={p.id} p={p} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">
            Nenhuma. Abra um gráfico e use o botão “Treino” para comprar com dinheiro fictício.
          </p>
        )}
      </section>
      <section className={card} aria-label="Ordens pendentes">
        <h2 className="font-semibold">Ordens pendentes</h2>
        {state?.orders.length ? (
          <ul className="divide-y divide-line text-sm">
            {state.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                <span className="font-medium">{o.symbolId.split(':')[1]}</span>
                <span>
                  {o.side === 'buy' ? 'Compra' : 'Venda'}{' '}
                  {o.type === 'market' ? 'a mercado' : o.type === 'limit' ? 'limitada' : 'stop'}{' '}
                  {o.price ? formatNumber(o.price, 2) : ''} · {formatNumber(o.qty, 6)}
                </span>
                <span className="text-xs text-muted">{formatDateTime(o.createdAt)}</span>
                <button
                  className="ml-auto text-xs text-down"
                  onClick={() => void usePaper.getState().cancel(o.id)}
                >
                  Cancelar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">Nenhuma.</p>
        )}
      </section>
      <Journal />
      <section className={card} aria-label="Eventos">
        <h2 className="font-semibold">Eventos</h2>
        <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
          {state?.events.map((e) => (
            <li key={e.id}>
              <span className="text-muted">{formatDateTime(e.time)}</span>{' '}
              <b className={e.kind === 'stop-movido-para-tras' ? 'text-down' : ''}>
                {PAPER_EVENT_LABEL[e.kind]}
              </b>{' '}
              {e.symbolId ? e.symbolId.split(':')[1] : ''} {e.detail}
            </li>
          ))}
        </ul>
      </section>
      <p className="text-[11px] text-muted">
        O treino usa o preço real da fonte de cada ativo (com o atraso indicado no gráfico), com
        custos e derrapagem, e o servidor executa stops e alvos mesmo com o app fechado. Só compras
        nesta versão: venda a descoberto exige aluguel/margem, ainda não simulados.
      </p>
      <NewAccount first={false} />
    </div>
  );
}
