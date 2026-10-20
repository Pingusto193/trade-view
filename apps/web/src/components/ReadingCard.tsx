import type { MarketReading, TrendLabel } from '@radar/core';
import { formatNumber } from '@radar/shared';
import { useState } from 'react';
import { analysisKey, useAnalysis } from '../lib/analysis-store';
import { HelpLink } from './HelpLink';

const TREND: Record<TrendLabel, { icon: string; title: string; tone: string; phrase: string }> = {
  alta: { icon: '↗', title: 'Tendência de alta', tone: 'text-up', phrase: 'em alta' },
  baixa: { icon: '↘', title: 'Tendência de baixa', tone: 'text-down', phrase: 'em baixa' },
  lateral: {
    icon: '→',
    title: 'Sem tendência (lateral)',
    tone: 'text-muted',
    phrase: 'sem tendência',
  },
  indefinida: {
    icon: '…',
    title: 'Ainda sem dados suficientes',
    tone: 'text-muted',
    phrase: 'indefinida',
  },
};

const VERDICT: Record<MarketReading['verdict'], { label: string; tone: string }> = {
  'sobe-mais': { label: 'Histórico: subiu mais que o normal', tone: 'bg-up/15 text-up' },
  'cai-mais': { label: 'Histórico: caiu mais que o normal', tone: 'bg-down/15 text-down' },
  'sem-vantagem': { label: 'Histórico: sem vantagem clara', tone: 'bg-panel-2 text-muted' },
  'poucos-casos': { label: 'Poucos casos para concluir', tone: 'bg-warn/15 text-warn' },
  'sem-dados': { label: 'Sem dados para comparar', tone: 'bg-panel-2 text-muted' },
};

const pct = (x: number | null) => (x === null ? '—' : `${formatNumber(x, 0)}%`);
const year = (t: number | null) => (t === null ? '' : String(new Date(t).getUTCFullYear()));

/**
 * Cartão do modo simples (ADR-0029): a tendência de agora e o que aconteceu antes neste ativo,
 * sempre contra um candle qualquer. Nunca promete direção.
 */
export function ReadingCard({ id, tf }: { id: string; tf: string }) {
  const r = useAnalysis((s) => s.byKey[analysisKey(id, tf)]?.reading ?? null);
  const [open, setOpen] = useState(() => window.innerWidth >= 1024);
  if (!r) {
    return (
      <section
        className="border-b border-line bg-panel px-3 py-2 text-xs text-muted"
        aria-label="Leitura simples"
      >
        Calculando a leitura… (precisa de pelo menos 31 candles fechados)
      </section>
    );
  }
  const t = TREND[r.trend];
  const v = VERDICT[r.verdict];
  const against =
    r.higherTrend &&
    ((r.trend === 'alta' && r.higherTrend === 'baixa') ||
      (r.trend === 'baixa' && r.higherTrend === 'alta'));
  const period = r.same.from !== null ? ` (${year(r.same.from)}–${year(r.same.to)})` : '';
  return (
    <section
      className="border-b border-line bg-panel px-3 py-2 text-sm"
      aria-label="Leitura simples"
      data-testid="reading-card"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className={`text-2xl leading-none ${t.tone}`} aria-hidden>
          {t.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold ${t.tone}`} data-testid="reading-trend">
            {t.title}
          </span>
          <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] ${v.tone}`}>
            {v.label}
          </span>
          {against && (
            <span className="ml-1 inline-block rounded bg-down/15 px-1.5 py-0.5 text-[11px] text-down">
              ⚠ contra a escala maior
            </span>
          )}
        </span>
        <span className="text-xs text-muted">{open ? 'menos ▲' : 'detalhes ▼'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1 text-xs text-muted" data-testid="reading-details">
          {r.trend !== 'indefinida' && r.same.cases > 0 ? (
            <p>
              Nas <b className="text-text">{r.same.cases}</b> vezes em que este ativo ficou{' '}
              {t.phrase} nesta escala{period}, o preço estava mais alto {r.horizon} candles depois
              em <b className="text-text">{pct(r.same.upPct)}</b> delas (variação mediana{' '}
              {r.same.medianMovePct === null ? '—' : `${formatNumber(r.same.medianMovePct, 1)}%`}).
              Num candle qualquer: <b className="text-text">{pct(r.base.upPct)}</b> ({r.base.cases}{' '}
              casos).
            </p>
          ) : (
            <p>Ainda não há casos parecidos suficientes no histórico carregado.</p>
          )}
          {r.higherTrend && r.higherLabel && (
            <p>
              Escala maior ({r.higherLabel}): {TREND[r.higherTrend].phrase}.
              {against && ' A escala maior costuma mandar: cuidado redobrado.'}
            </p>
          )}
          <p className="flex items-center gap-1">
            Não é previsão: o passado não garante o futuro, e custos e imposto não entram nesta
            conta. <HelpLink slug="leitura-simples" label="Como funciona a leitura simples" />
          </p>
        </div>
      )}
    </section>
  );
}
