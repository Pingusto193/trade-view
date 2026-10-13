import {
  readiness,
  readinessParamsSchema,
  type ReadinessItem,
  type ReadinessParams,
} from '@radar/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cdiBetween } from '../lib/macro';
import { usePaper, type PaperJournal } from '../lib/paper-store';
import { usePrefs } from '../lib/prefs';
import { HelpLink } from './HelpLink';

const ICON: Record<ReadinessItem['status'], { icon: string; cls: string; text: string }> = {
  ok: { icon: '✓', cls: 'text-up', text: 'ok' },
  falta: { icon: '✕', cls: 'text-down', text: 'falta' },
  'sem-dados': { icon: '?', cls: 'text-muted', text: 'sem dados' },
};

const taxOf = (j: PaperJournal) =>
  j.tax.reduce((s, m) => s + m.darf, 0) + (j.tax.at(-1)?.pendingBelowMin ?? 0);

function Editor({ value, onSave }: { value: ReadinessParams; onSave(p: ReadinessParams): void }) {
  const [v, setV] = useState(value);
  const field = (k: keyof ReadinessParams, label: string) => (
    <label className="text-xs">
      <span className="block text-muted">{label}</span>
      <input
        type="number"
        className="w-full rounded border border-line bg-panel px-2 py-1"
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
      />
    </label>
  );
  const parsed = readinessParamsSchema.safeParse(v);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">Ajustar a régua</summary>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field('minTrades', 'Trades no total')}
        {field('minLive', 'Dos quais ao vivo')}
        {field('minDisciplinePct', 'Disciplina mínima (%)')}
        {field('maxDrawdownPct', 'Queda máxima (%)')}
      </div>
      <button
        type="button"
        disabled={!parsed.success}
        className="mt-2 rounded border border-line px-2 py-1 text-xs disabled:opacity-50"
        onClick={() => parsed.success && onSave(parsed.data)}
      >
        Salvar régua
      </button>
      {!parsed.success && <p className="text-xs text-down">Algum número está fora do permitido.</p>}
    </details>
  );
}

/**
 * Painel de prontidão (SPEC §13): mostra o que falta, com números, para os resultados do treino
 * justificarem dinheiro real. Régua nossa, editável; nunca bloqueia o modo Real.
 */
export function ReadinessPanel({ editable = true }: { editable?: boolean }) {
  const { activeId, load, loaded, state } = usePaper();
  const maxRiskPct = usePrefs((s) => s.maxRiskPct);
  const params = usePrefs((s) => s.readiness);
  const setReadiness = usePrefs((s) => s.setReadiness);
  const [all, setAll] = useState<PaperJournal | null>(null);
  const [cur, setCur] = useState<PaperJournal | null>(null);
  const [cdi, setCdi] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const id = activeId();
  // quando uma posição fecha, o número de abertas muda: recalcula
  const openCount = state?.positions.length ?? 0;

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    Promise.all([
      api<PaperJournal>(`/api/paper/accounts/${id}/journal?all=1`),
      api<PaperJournal>(`/api/paper/accounts/${id}/journal?all=0`),
    ])
      .then(([a, c]) => {
        if (!alive) return;
        setAll(a);
        setCur(c);
        const start = c.account.resetAt ?? c.account.createdAt;
        void cdiBetween(start, Date.now())
          .then((x) => alive && setCdi(x ? x.acc : null))
          .catch(() => alive && setCdi(null));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id, openCount]);

  if (!id)
    return (
      <p className="text-sm text-muted">Crie uma conta de treino para ver o painel de prontidão.</p>
    );
  if (error) return <p className="text-sm text-down">Painel de prontidão indisponível: {error}</p>;
  if (!all || !cur) return <p className="text-sm text-muted">Calculando o painel de prontidão…</p>;

  const r = readiness({
    trades: all.trades,
    current: {
      initialBalance: cur.account.initialBalance,
      totalBrl: cur.stats.totalBrl,
      taxBrl: taxOf(cur),
      maxDrawdownPct: cur.stats.maxDrawdownPct,
    },
    cdiAcc: cdi,
    maxRiskPct,
    params,
  });
  return (
    <section
      className="space-y-2 rounded border border-line p-3"
      aria-label="Painel de prontidão"
      data-testid="readiness"
    >
      <h2 className="font-semibold">
        Painel de prontidão{' '}
        <HelpLink slug="antes-de-arriscar-dinheiro" label="Ajuda: antes de arriscar dinheiro" />
      </h2>
      <p className="text-xs text-muted">
        Régua nossa, editável — não é garantia de nada. Ela nunca bloqueia o modo Real: só mostra o
        que falta e por quê.
      </p>
      <p className={`text-sm font-semibold ${r.ready ? 'text-up' : 'text-warn'}`}>
        {r.ready
          ? '✓ Os números do treino passam na régua. Ainda assim: comece pequeno.'
          : `⚠ Faltam ${r.items.filter((x) => x.status !== 'ok').length} de ${r.items.length} critérios.`}
      </p>
      <ul className="space-y-1.5">
        {r.items.map((x) => (
          <li key={x.key} className="text-sm">
            <span className={`font-semibold ${ICON[x.status].cls}`}>
              <span aria-hidden>{ICON[x.status].icon}</span> {x.label}
              <span className="sr-only"> ({ICON[x.status].text})</span>
            </span>
            <span className="block text-xs text-muted">{x.detail}</span>
          </li>
        ))}
      </ul>
      {editable && <Editor value={params} onSave={setReadiness} />}
    </section>
  );
}
