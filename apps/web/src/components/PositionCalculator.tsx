import { positionSize, riskPctWarnings, type PositionResult } from '@radar/core';
import { REAL_MARKETS, formatBRL, formatNumber, formatTrim, type RealMarket } from '@radar/shared';
import { useState } from 'react';
import { usePrefs } from '../lib/prefs';

/** Aceita "1.234,56", "1234,56" e "1234.56". */
export const parseNum = (s: string): number | null => {
  const v = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return s.trim() && Number.isFinite(v) ? v : null;
};

export interface CalcInput {
  market: RealMarket;
  capitalBrl: number;
  riskPct: number;
  entry: number;
  stop: number;
  target: number | null;
  /** R$ por unidade da moeda do ativo (1 em reais). */
  fx: number;
  /** Passo/lote mínimo (cripto e forex variam por corretora). */
  step?: number;
}

/** Tamanho pelo risco com as regras do mercado (SPEC §11). Resultados em R$. */
export function sizeFor(i: CalcInput): (PositionResult & { fx: number }) | null {
  const m = REAL_MARKETS[i.market];
  const step = i.step && i.step > 0 ? i.step : m.qtyStep;
  try {
    const r = positionSize({
      capital: i.capitalBrl / i.fx,
      riskPct: i.riskPct,
      entry: i.entry,
      stop: i.stop,
      ...(i.target !== null ? { target: i.target } : {}),
      lotSize: m.lotSize === m.qtyStep ? step : m.lotSize,
      minQty: m.minQty === m.qtyStep ? step : m.minQty,
      qtyStep: step,
      pointValue: m.pointValue,
      fractional: m.fractional,
    });
    return { ...r, fx: i.fx };
  } catch {
    return null;
  }
}

const field = 'w-full rounded border border-line bg-bg px-2 py-1 text-sm';

export function CalcResult({
  r,
  market,
  showAllocated = true,
}: {
  r: PositionResult & { fx: number };
  market: RealMarket;
  showAllocated?: boolean;
}) {
  const m = REAL_MARKETS[market];
  const brl = (x: number) => formatBRL(x * r.fx);
  const qty = formatTrim(r.quantity, 5);
  return (
    <div className="space-y-1 text-sm" data-testid="calc-result">
      <p>
        <b className="text-base">
          {qty} {m.qtyLabel}
        </b>
        {market === 'b3-acao' && r.quantity > 0 && (
          <span className="text-muted">
            {' '}
            ({r.standardLots} {r.standardLots === 1 ? 'lote' : 'lotes'} de 100
            {r.fractionalQty > 0 ? ` + ${r.fractionalQty} no fracionário` : ''})
          </span>
        )}
      </p>
      <div className="grid grid-cols-2 gap-x-3 text-xs">
        <span className="text-muted">Perda máxima no stop</span>
        <span className="text-down">{brl(r.maxLoss)}</span>
        {r.gainAtTarget !== null && (
          <>
            <span className="text-muted">Ganho no alvo</span>
            <span className="text-up">{brl(r.gainAtTarget)}</span>
          </>
        )}
        {r.rr !== null && (
          <>
            <span className="text-muted">Retorno/risco</span>
            <span>{formatNumber(r.rr, 2)}R</span>
          </>
        )}
        {showAllocated && (
          <>
            <span className="text-muted">
              {market.startsWith('b3-w') ? 'Valor exposto (nocional)' : 'Valor alocado'}
            </span>
            <span>{brl(r.allocated)}</span>
          </>
        )}
      </div>
      {market.startsWith('b3-w') && (
        <p className="text-[11px] text-muted">
          Nos minicontratos a corretora pede só uma margem de garantia (varia por corretora), mas a
          perda é sobre o valor exposto inteiro.
        </p>
      )}
    </div>
  );
}

/** Calculadora de posição avulsa (SPEC §11): capital, risco, entrada e stop → quantidade e R$. */
export function PositionCalculator() {
  const capital = usePrefs((s) => s.capital);
  const riskPct = usePrefs((s) => s.riskPct);
  const maxRiskPct = usePrefs((s) => s.maxRiskPct);
  const setRisk = usePrefs((s) => s.setRisk);
  const [market, setMarket] = useState<RealMarket>('b3-acao');
  const [cap, setCap] = useState(String(capital));
  const [risk, setRiskS] = useState(String(riskPct));
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [fx, setFx] = useState('');
  const [step, setStep] = useState('');
  const [quote, setQuote] = useState('USD');
  const m = REAL_MARKETS[market];
  // no forex o resultado sai na moeda de COTAÇÃO do par (USDJPY → iene)
  const cur = market === 'forex' ? quote.trim().toUpperCase() || 'USD' : m.currency;
  const foreign = cur !== 'BRL';
  const v = {
    cap: parseNum(cap),
    risk: parseNum(risk),
    entry: parseNum(entry),
    stop: parseNum(stop),
    target: parseNum(target),
    fx: foreign ? parseNum(fx) : 1,
    step: parseNum(step),
  };
  const ready =
    v.cap !== null &&
    v.cap > 0 &&
    v.risk !== null &&
    v.risk > 0 &&
    v.entry !== null &&
    v.stop !== null &&
    v.fx !== null &&
    v.fx > 0;
  const r = ready
    ? sizeFor({
        market,
        capitalBrl: v.cap!,
        riskPct: v.risk!,
        entry: v.entry!,
        stop: v.stop!,
        target: v.target,
        fx: v.fx!,
        ...(v.step ? { step: v.step } : {}),
      })
    : null;
  const warnings = [
    ...(v.risk !== null ? riskPctWarnings(v.risk, maxRiskPct) : []),
    ...(r?.warnings ?? []),
    ...(ready && v.entry === v.stop ? ['Stop igual à entrada: não existe risco zero.'] : []),
  ];
  const inp = (label: string, value: string, set: (s: string) => void, hint?: string) => (
    <label className="block text-xs">
      <span className="text-muted">{label}</span>
      <input
        className={field}
        inputMode="decimal"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  );
  return (
    <section
      className="space-y-3 rounded border border-line bg-panel p-3"
      aria-label="Calculadora de posição"
    >
      <label className="block text-xs">
        <span className="text-muted">Mercado</span>
        <select
          className={field}
          value={market}
          onChange={(e) => {
            setMarket(e.target.value as RealMarket);
            setStep('');
          }}
        >
          {Object.entries(REAL_MARKETS).map(([k, x]) => (
            <option key={k} value={k}>
              {x.label}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted">{m.note}</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {inp('Capital (R$)', cap, setCap)}
        {inp('Risco por trade (%)', risk, setRiskS, `Seu limite: ${formatNumber(maxRiskPct, 1)}%`)}
        {market === 'forex' &&
          inp('Moeda de cotação do par', quote, setQuote, 'EURUSD → USD; USDJPY → JPY')}
        {inp(`Entrada (${cur})`, entry, setEntry)}
        {inp(`Stop técnico (${cur})`, stop, setStop, 'Onde a tese morre')}
        {inp(`Alvo (opcional)`, target, setTarget)}
        {foreign && inp(`Câmbio: R$ por 1 ${cur}`, fx, setFx, 'O que você paga hoje')}
        {(market === 'cripto' || market === 'forex') &&
          inp(`Passo mínimo (${m.qtyLabel})`, step, setStep, `Padrão: ${formatTrim(m.qtyStep, 5)}`)}
      </div>
      {r ? (
        <CalcResult r={r} market={market} />
      ) : (
        <p className="text-xs text-muted">
          Preencha capital, risco, entrada e stop{foreign ? ' e o câmbio' : ''}.
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-warn" role="alert">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {v.cap !== null &&
        v.risk !== null &&
        (v.cap !== capital || v.risk !== riskPct) &&
        v.cap > 0 &&
        v.risk > 0 &&
        v.risk <= 10 && (
          <button
            type="button"
            className="text-xs text-accent underline"
            onClick={() => setRisk({ capital: v.cap!, riskPct: v.risk! })}
          >
            Guardar capital e risco como padrão
          </button>
        )}
    </section>
  );
}
