import type { EventStudy, GroupStudy } from '@radar/core';
import { formatDate, formatNumber, type Timeframe } from '@radar/shared';
import { useState } from 'react';
import { api } from '../lib/api';

interface Resp {
  radar: { study: EventStudy; events: number; since: number | null };
  cvm: { study: EventStudy | null; events: number; years: number[]; errors: string[] } | null;
  notes: string[];
}

const GROUP_LABEL: Record<string, string> = {
  'tipo:noticia': 'Notícias de veículos',
  'tipo:oficial': 'Oficiais (BCB, Copom, Fed, BLS)',
  'tipo:sec-8k': 'Comunicados 8-K (SEC)',
  'tipo:fato-relevante': 'Fatos relevantes',
  'tema:juros-br': 'Tema: juros no Brasil',
  'tema:juros-us': 'Tema: juros nos EUA',
  'tema:inflacao-br': 'Tema: inflação no Brasil',
  'tema:inflacao-us': 'Tema: inflação nos EUA',
  'tema:emprego-us': 'Tema: emprego nos EUA',
  'tema:fiscal-br': 'Tema: contas públicas',
  'tema:USD': 'Tema: dólar',
  'ia:positivo': 'IA leu como positiva',
  'ia:negativo': 'IA leu como negativa',
  'ia:relevante': 'IA: relevância 4–5',
  'cvm:fato-relevante': 'Fatos relevantes (CVM, histórico)',
};
const label = (g: string) => GROUP_LABEL[g] ?? g.replace(/^tema:/, 'Tema: ');
const pct = (x: number | null, d = 1) =>
  x === null ? '—' : `${x > 0 ? '+' : ''}${formatNumber(x * 100, d)}%`;
const share = (x: number | null) => (x === null ? '—' : `${formatNumber(x * 100, 0)}%`);

function GroupTable({ g, min }: { g: GroupStudy; min: number }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold">
        {label(g.group)}
        {g.medianDriftBefore !== null && (
          <span className="ml-1 font-normal text-muted">
            · 5 candles antes: {pct(g.medianDriftBefore)}
          </span>
        )}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[330px] text-[11px]">
          <thead className="text-muted">
            <tr>
              <th className="text-left font-normal">Depois</th>
              <th className="pl-2 text-right font-normal">n</th>
              <th className="pl-2 text-right font-normal">Subiu</th>
              <th className="pl-2 text-right font-normal">Mediana</th>
              <th
                className="pl-2 text-right font-normal"
                title="Tamanho do movimento ÷ o de um candle qualquer"
              >
                Tamanho
              </th>
              <th
                className="pl-2 text-right font-normal"
                title="Fração do movimento que já tinha acontecido quando a notícia chegou ao Radar"
              >
                Antes de chegar
              </th>
            </tr>
          </thead>
          <tbody>
            {g.horizons.map((h) => (
              <tr key={h.horizon} className="border-t border-line/60">
                <td className="py-0.5">{h.horizon} candle(s)</td>
                <td className="whitespace-nowrap py-0.5 pl-2 text-right tabular-nums">
                  {h.n}
                  {h.n > 0 && h.n < min && <span className="text-warn"> !</span>}
                </td>
                <td className="whitespace-nowrap py-0.5 pl-2 text-right tabular-nums">
                  {h.upRate === null ? '—' : `${formatNumber(h.upRate * 100, 0)}%`}
                </td>
                <td className="whitespace-nowrap py-0.5 pl-2 text-right tabular-nums">
                  {pct(h.medianMove)}
                </td>
                <td className="whitespace-nowrap py-0.5 pl-2 text-right tabular-nums">
                  {h.vsBaseline === null ? '—' : `${formatNumber(h.vsBaseline, 1)}×`}
                </td>
                <td className="whitespace-nowrap py-0.5 pl-2 text-right tabular-nums">
                  {h.nArrival ? `${share(h.shareBeforeArrival)} (n ${h.nArrival})` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Study({ s, min }: { s: EventStudy; min: number }) {
  if (!s.groups.length)
    return <p className="text-xs text-muted">Nenhum evento no período dos candles.</p>;
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        Régua (um candle qualquer): tamanho médio{' '}
        {s.baseline.map((b) => `${b.horizon}c ${pct(b.meanAbsMove)}`).join(' · ')}; subiu{' '}
        {s.baseline
          .map((b) => (b.upRate === null ? '—' : `${formatNumber(b.upRate * 100, 0)}%`))
          .join(' · ')}
        .
      </p>
      {s.groups.slice(0, 8).map((g) => (
        <GroupTable key={g.group} g={g} min={min} />
      ))}
    </div>
  );
}

/**
 * Estudo de evento do ativo (SPEC §23.1): o que o preço fez depois de cada tipo de notícia, com n, e
 * quanto já tinha acontecido quando a notícia chegou. Calcula só quando pedido (a CVM é pesada).
 */
export function EventStudyBox({ id, tf }: { id: string; tf: Timeframe }) {
  const [r, setR] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    setErr(null);
    api<Resp>(`/api/news/event-study?symbolId=${encodeURIComponent(id)}&tf=${tf}`)
      .then(setR)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <section
      className="space-y-2 border-t border-line p-3 text-sm"
      aria-label="Estudo de evento"
      data-testid="event-study"
    >
      <h3 className="text-xs font-semibold">O que o preço fez depois das notícias</h3>
      <p className="text-[11px] text-muted">
        Mede a partir do último candle fechado antes da publicação; "antes de chegar" = parte do
        movimento que já tinha acontecido quando a notícia chegou ao Radar. Sem custos. "!" = menos
        de 30 casos: não conclua nada.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded border border-accent px-2 py-1 text-xs text-accent disabled:opacity-50"
      >
        {busy ? 'Calculando… (a CVM pode demorar)' : r ? 'Recalcular' : 'Calcular estudo de evento'}
      </button>
      {err && <p className="text-xs text-down">{err}</p>}
      {r && (
        <div className="space-y-3">
          <div>
            <h4 className="text-xs font-semibold">
              Notícias do Radar ({r.radar.events}
              {r.radar.since !== null ? ` desde ${formatDate(r.radar.since)}` : ''})
            </h4>
            <Study s={r.radar.study} min={30} />
          </div>
          {r.cvm && (
            <div>
              <h4 className="text-xs font-semibold">
                Fatos relevantes da CVM ({r.cvm.events} em {r.cvm.years.join(', ')})
              </h4>
              {r.cvm.study ? (
                <Study s={r.cvm.study} min={30} />
              ) : (
                <p className="text-xs text-muted">Nenhum fato relevante encontrado.</p>
              )}
              {r.cvm.errors.map((e) => (
                <p key={e} className="text-[11px] text-down">
                  CVM {e}
                </p>
              ))}
            </div>
          )}
          <ul className="list-disc pl-4 text-[11px] text-muted">
            {r.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
