import { positionSize, riskPctWarnings } from '@radar/core';
import { formatBRL, formatNumber, type SymbolMeta, type Timeframe } from '@radar/shared';
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

  useEffect(() => {
    if (!usePaper.getState().loaded) void usePaper.getState().load();
    void getMeta(symbolId)
      .then(setMeta)
      .catch((e: Error) => setMsg(e.message));
    void getCandles(symbolId, '1d', 2)
      .then((r) => setLast(r.candles.at(-1)?.close ?? null))
      .catch(() => undefined);
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
    ...(ctx?.wind.value === 'contra' ? ['⚠ Compra contra a escala maior (aviso vermelho).'] : []),
    ...(ctx?.adx.value === 'lateral' ? ['ADX abaixo de 20: mercado lateral.'] : []),
  ];

  const submit = async () => {
    setMsg(null);
    const q = numDot(qty) ?? sizing?.quantity ?? null;
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
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Por que esta compra? (motivo técnico)"
              className={field}
              aria-label="Motivo"
            />
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
              Comprar no treino
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
