import { SETUP_LABEL, positionSize, riskPctWarnings, type SetupId } from '@radar/core';
import {
  EXIT_CRITERIA,
  FRACTAL_MAPPINGS,
  PSYCH_CHECKS,
  TIMEFRAMES,
  TIMEFRAME_LABEL,
  formatBRL,
  formatNumber,
  higherTimeframe,
  isIntraday,
  planMissing,
  type PsychCheck,
  type SymbolMeta,
  type Timeframe,
  type TradePlan,
} from '@radar/shared';
import { chartScreenshot } from '../chart/registry';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { Link } from 'react-router-dom';
import { analysisKey, useAnalysis } from '../lib/analysis-store';
import { getCandles, getMeta } from '../lib/api';
import { usePaper } from '../lib/paper-store';
import { usePrefs } from '../lib/prefs';
import { HelpLink } from './HelpLink';

/** Boleta do Modo Treino aberta de qualquer gráfico. */
export const useTicket = create<{
  target: { symbolId: string; tf: Timeframe } | null;
  open(symbolId: string, tf: Timeframe): void;
  close(): void;
}>()((set) => ({
  target: null,
  open: (symbolId, tf) => set({ target: { symbolId, tf } }),
  close: () => set({ target: null }),
}));

/** Constante estável: um [] novo a cada render faria o seletor re-renderizar sem parar. */
const NO_OPEN: readonly { setup: SetupId; side: string; state: string }[] = [];

const field = 'w-full rounded border border-line bg-bg px-2 py-1 text-sm';
/** Aceita "1.234,56", "1234,56" e "1234.56". */
const numDot = (s: string) => {
  const v = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return s.trim() && Number.isFinite(v) ? v : null;
};

export function OrderTicket() {
  const target = useTicket((s) => s.target);
  const close = useTicket((s) => s.close);
  if (!target) return null;
  return <Ticket key={target.symbolId} symbolId={target.symbolId} tf={target.tf} onClose={close} />;
}

function Ticket({ symbolId, tf, onClose }: { symbolId: string; tf: Timeframe; onClose(): void }) {
  const prefs = usePrefs();
  const paper = usePaper();
  const ctx = useAnalysis((s) => s.byKey[analysisKey(symbolId, tf)]?.context ?? null);
  const [meta, setMeta] = useState<SymbolMeta | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [type, setType] = useState<'market' | 'limit' | 'stop'>('market');
  const [price, setPrice] = useState('');
  const [stop, setStop] = useState('');
  const [tgt, setTgt] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // plano de trade (SPEC §11)
  const openSetups = useAnalysis((s) => s.byKey[analysisKey(symbolId, tf)]?.open ?? NO_OPEN);
  const mapping = FRACTAL_MAPPINGS.find((m) => m.setup === tf);
  const [setup, setSetup] = useState<string>(
    openSetups.find((o) => o.side === 'buy' && o.state !== 'radar')?.setup ?? '',
  );
  const [tfs, setTfs] = useState({
    context: mapping?.context ?? higherTimeframe(tf) ?? tf,
    setup: tf,
    trigger: mapping?.trigger ?? tf,
  });
  const [aligned, setAligned] = useState(false);
  const [exitCriterion, setExitCriterion] = useState<TradePlan['exitCriterion']>('alvo');
  const [checks, setChecks] = useState<Partial<Record<PsychCheck, boolean>>>({});
  const [shot, setShot] = useState<string | null>(null);
  useEffect(() => {
    // print automático do gráfico aberto
    setShot(chartScreenshot(`${symbolId}|${tf}`));
  }, [symbolId, tf]);

  useEffect(() => {
    if (!usePaper.getState().loaded) void usePaper.getState().load();
    void getMeta(symbolId)
      .then((m) => {
        setMeta(m);
        // mesmo preço que o servidor usa para executar: o do candle mais curto disponível
        const tfExec = m.timeframes.includes('1m')
          ? '1m'
          : (m.timeframes.find((t) => isIntraday(t)) ?? '1d');
        return getCandles(symbolId, tfExec, 2).then((r) =>
          setLast(r.candles.at(-1)?.close ?? null),
        );
      })
      .catch((e: Error) => setMsg(e.message));
  }, [symbolId]);

  const entry = type === 'market' ? last : numDot(price);
  const stopV = numDot(stop);
  const tgtV = numDot(tgt);
  const equity = paper.state?.equity ?? null;
  const fxNote = meta && meta.currency !== 'BRL';

  const sizing = useMemo(() => {
    if (!meta || entry === null || stopV === null || equity === null || stopV >= entry) return null;
    try {
      // capital em R$ convertido para a moeda do ativo quando for dólar
      const fx = meta.currency === 'BRL' ? 1 : (paper.state?.fx ?? null);
      if (fx === null) return null;
      return positionSize({
        capital: equity / fx,
        riskPct: prefs.riskPct,
        entry,
        stop: stopV,
        ...(tgtV !== null ? { target: tgtV } : {}),
        lotSize: meta.lotSize,
        minQty: meta.minQty,
        qtyStep: meta.qtyStep,
        pointValue: meta.pointValue,
        fractional: meta.market === 'b3',
      });
    } catch {
      return null;
    }
  }, [meta, entry, stopV, tgtV, equity, prefs.riskPct, paper.state?.fx]);

  const warnings = [
    ...(stopV === null
      ? ['Sem stop: o trade não tem risco definido e não entra nas estatísticas em R.']
      : []),
    ...(sizing?.warnings ?? []),
    ...riskPctWarnings(prefs.riskPct, prefs.maxRiskPct),
    // a boleta do treino só compra: o aviso vermelho vale quando a escala maior está em baixa
    ...(ctx?.wind.against === 'compras'
      ? ['⚠ Compra contra a escala maior (aviso vermelho).']
      : []),
    ...(ctx?.adx.value === 'lateral' ? ['ADX abaixo de 20: mercado lateral.'] : []),
  ];

  const qtyValue = numDot(qty) ?? sizing?.quantity ?? null;
  const plan: TradePlan = {
    setup: setup || '',
    tfContext: tfs.context,
    tfSetup: tfs.setup,
    tfTrigger: tfs.trigger,
    aligned,
    exitCriterion,
    reason: note,
    checks,
    warnings: [],
    screenshot: shot,
  };
  const missing = planMissing(plan, {
    stopLoss: stopV,
    takeProfit: tgtV,
    qty: qtyValue,
  });
  const stopsToday = paper.state?.stops.today ?? 0;
  const stopsWeek = paper.state?.stops.week ?? 0;
  const pause = stopsToday >= prefs.antiRevengeDay || stopsWeek >= prefs.antiRevengeWeek;

  const submit = async () => {
    setMsg(null);
    const q = qtyValue;
    if (!q || q <= 0) {
      setMsg('Informe a quantidade (ou preencha o stop para o cálculo pelo risco).');
      return;
    }
    setBusy(true);
    try {
      const o = await paper.order({
        symbolId,
        side: 'buy',
        type,
        qty: q,
        price: type === 'market' ? null : numDot(price),
        stopLoss: stopV,
        takeProfit: tgtV,
        note,
        plan: { ...plan, warnings: warnings.slice(0, 20) },
      });
      setMsg(
        o.status === 'filled'
          ? `Executada a ${formatNumber(o.fillPrice ?? 0, meta?.priceDecimals ?? 2)} (preço real + custos).`
          : o.status === 'pending'
            ? 'Ordem pendente: o servidor executa quando o preço real chegar lá.'
            : `Recusada: ${o.reason ?? ''}`,
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const noAccount = paper.loaded && paper.accounts.length === 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      role="dialog"
      aria-label="Boleta de treino"
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-xl border border-train/60 bg-panel p-3 text-sm sm:rounded-xl">
        <div className="mb-2 flex items-center gap-2">
          <b>Treino · comprar {symbolId.split(':')[1]}</b>
          <span className="rounded bg-train/20 px-1.5 text-[10px] font-bold text-train">
            DINHEIRO FICTÍCIO
          </span>
          <button className="ml-auto text-muted" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        {noAccount ? (
          <p>
            Você ainda não tem conta de treino.{' '}
            <Link to="/treino" onClick={onClose} className="text-accent underline">
              Criar agora
            </Link>
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              Último preço real:{' '}
              {last === null ? '—' : formatNumber(last, meta?.priceDecimals ?? 2)} {meta?.currency}{' '}
              · Patrimônio de treino: {equity === null ? '—' : formatBRL(equity)}
              {fxNote && paper.state?.fx ? ` · dólar ${formatNumber(paper.state.fx, 4)}` : ''}
            </p>
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
                  onClick={() => setType(k)}
                  aria-pressed={type === k}
                  className={`rounded border px-2 py-1 text-xs ${type === k ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            {type !== 'market' && (
              <label className="block text-xs">
                {type === 'limit'
                  ? 'Preço limite (compra só abaixo dele)'
                  : 'Gatilho (compra se romper)'}
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={field}
                  inputMode="decimal"
                  aria-label="Preço da ordem"
                />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs">
                Stop (onde a tese morre)
                <input
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                  className={field}
                  inputMode="decimal"
                  aria-label="Stop"
                />
              </label>
              <label className="block text-xs">
                Alvo
                <input
                  value={tgt}
                  onChange={(e) => setTgt(e.target.value)}
                  className={field}
                  inputMode="decimal"
                  aria-label="Alvo"
                />
              </label>
            </div>
            <label className="block text-xs">
              Quantidade{' '}
              {sizing && (
                <span className="text-muted">
                  (pelo risco de {prefs.riskPct}%:{' '}
                  {formatNumber(sizing.quantity, sizing.quantity % 1 ? 6 : 0)})
                </span>
              )}{' '}
              <HelpLink
                slug="gestao-de-risco"
                label="Ajuda: tamanho da posição"
                className="align-middle"
              />
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder={sizing ? String(sizing.quantity) : ''}
                className={field}
                inputMode="decimal"
                aria-label="Quantidade"
              />
            </label>
            {sizing && (
              <p className="text-xs text-muted">
                Perda máxima {formatNumber(sizing.maxLoss, 2)} {meta?.currency}
                {sizing.rr !== null ? ` · R:R ${formatNumber(sizing.rr, 2)}` : ''} · alocado{' '}
                {formatNumber(sizing.allocated, 2)} {meta?.currency}
              </p>
            )}
            <fieldset
              className="space-y-2 rounded border border-line p-2"
              aria-label="Plano de trade"
            >
              <legend className="px-1 text-xs font-semibold">
                Plano de trade{' '}
                <HelpLink
                  slug="gestao-de-risco"
                  label="Ajuda: plano de trade"
                  className="align-middle"
                />
              </legend>
              <label className="block text-xs">
                Setup
                <select
                  value={setup}
                  onChange={(e) => setSetup(e.target.value)}
                  className={field}
                  aria-label="Setup do plano"
                >
                  <option value="">— escolha —</option>
                  {(Object.keys(SETUP_LABEL) as SetupId[]).map((k) => (
                    <option key={k} value={k}>
                      {SETUP_LABEL[k]}
                      {openSetups.some((o) => o.setup === k && o.state !== 'radar')
                        ? ' (em andamento no gráfico)'
                        : ''}
                    </option>
                  ))}
                  <option value="manual">Leitura própria (sem setup do app)</option>
                </select>
              </label>
              <div className="grid grid-cols-3 gap-1 text-xs">
                {(
                  [
                    ['context', 'Contexto'],
                    ['setup', 'Setup'],
                    ['trigger', 'Gatilho'],
                  ] as const
                ).map(([k, l]) => (
                  <label key={k} className="block">
                    {l}
                    <select
                      value={tfs[k]}
                      onChange={(e) => setTfs({ ...tfs, [k]: e.target.value as Timeframe })}
                      className={field}
                      aria-label={`Escala de ${l.toLowerCase()}`}
                    >
                      {TIMEFRAMES.map((t) => (
                        <option key={t} value={t}>
                          {TIMEFRAME_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={aligned}
                  onChange={(e) => setAligned(e.target.checked)}
                />
                As três escalas estão a favor da compra
                {ctx && (
                  <span className={ctx.wind.value === 'contra' ? 'text-down' : 'text-muted'}>
                    (painel: escala maior {ctx.wind.label.toLowerCase()})
                  </span>
                )}
              </label>
              <label className="block text-xs">
                Critério de saída
                <select
                  value={exitCriterion}
                  onChange={(e) => setExitCriterion(e.target.value as TradePlan['exitCriterion'])}
                  className={field}
                  aria-label="Critério de saída"
                >
                  {Object.entries(EXIT_CRITERIA).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 1000))}
                placeholder="Motivo técnico: o que você vê no gráfico que justifica a compra?"
                className={`${field} min-h-16`}
                aria-label="Motivo"
              />
              <div className="flex items-center gap-2 text-xs">
                {shot ? (
                  <img
                    src={shot}
                    alt="Print do gráfico no plano"
                    className="h-14 rounded border border-line"
                  />
                ) : (
                  <span className="text-muted">Sem print (abra pelo gráfico).</span>
                )}
                <button
                  type="button"
                  className="rounded border border-line px-2 py-0.5"
                  onClick={() => setShot(chartScreenshot(`${symbolId}|${tf}`))}
                >
                  Tirar print de novo
                </button>
              </div>
              <fieldset className="space-y-0.5 text-xs" aria-label="Checklist psicológico">
                {(Object.entries(PSYCH_CHECKS) as [PsychCheck, string][]).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(checks[k])}
                      onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })}
                    />
                    {l}
                  </label>
                ))}
              </fieldset>
              <p
                className={`rounded px-2 py-1 text-xs font-semibold ${missing.length ? 'bg-warn/15 text-warn' : 'bg-up/15 text-up'}`}
                data-testid="plan-status"
              >
                {missing.length
                  ? `Plano incompleto — falta: ${missing.join(', ')}`
                  : '✅ Plano liberado'}
              </p>
            </fieldset>
            {pause && (
              <p
                className="rounded border border-down/60 bg-down/15 p-2 text-xs text-down"
                role="alert"
              >
                Pausa recomendada: {stopsToday} stop(s) hoje e {stopsWeek} nos últimos 7 dias.
                Depois de perdas seguidas, o risco de operar por revanche aumenta. Se for entrar,
                reduza o tamanho.
              </p>
            )}
            {warnings.length > 0 && (
              <ul className="space-y-0.5 text-xs text-warn">
                {warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            )}
            {msg && (
              <p className="text-xs" data-testid="ticket-msg">
                {msg}
              </p>
            )}
            <button
              onClick={() => void submit()}
              disabled={busy || !meta}
              className="w-full rounded bg-train px-3 py-2 font-semibold text-black disabled:opacity-50"
            >
              {missing.length
                ? 'Comprar sem plano completo (conta como indisciplina)'
                : 'Comprar no treino (plano liberado)'}
            </button>
            <p className="text-[11px] text-muted">
              Executa com o preço real da fonte, mais spread, derrapagem e taxas. Para vender, use
              “Encerrar” ou o stop/alvo na página Treino.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
