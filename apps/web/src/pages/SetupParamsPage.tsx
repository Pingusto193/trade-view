import { DEFAULT_SETUP_PARAMS, setupParamsSchema, type SetupParams } from '@radar/core';
import { formatNumber } from '@radar/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpLink } from '../components/HelpLink';
import { usePrefs } from '../lib/prefs';
import {
  PARAM_GROUPS,
  changedPaths,
  crossErrors,
  defaultOf,
  getAt,
  setAt,
  type ParamField,
  type ParamGroup,
} from '../lib/setup-param-fields';

const num = (v: number, f: Extract<ParamField, { kind: 'number' }>) =>
  f.pct ? `${formatNumber(v * 100, 0)}%` : formatNumber(v, f.int ? 0 : Math.abs(v % 1) > 0 ? 2 : 0);

function show(f: ParamField, v: unknown): string {
  if (f.kind === 'bool') return v ? 'sim' : 'não';
  if (f.kind === 'enum') return f.options.find((o) => o.value === v)?.label ?? String(v);
  return typeof v === 'number' ? num(v, f) : '—';
}

function Field({
  group,
  field: f,
  value,
  active,
  error,
  onChange,
}: {
  group: ParamGroup;
  field: ParamField;
  value: unknown;
  active: boolean;
  error: boolean;
  onChange(v: unknown): void;
}) {
  const def = defaultOf(group.key, f.path);
  const changed = value !== def;
  const id = `p-${group.key}-${f.path.replace('.', '-')}`;
  let input;
  if (f.kind === 'bool')
    input = (
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0"
        checked={value === true}
        disabled={!active}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  else if (f.kind === 'enum')
    input = (
      <select
        id={id}
        className="w-full rounded border border-line bg-panel px-2 py-1 sm:w-auto"
        value={String(value)}
        disabled={!active}
        onChange={(e) => onChange(e.target.value)}
      >
        {f.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  else {
    const n = typeof value === 'number' && !Number.isNaN(value) ? value : null;
    const shown = n === null ? '' : f.pct ? Math.round(n * 100 * 1e6) / 1e6 : n;
    input = (
      <span className="flex items-center gap-1">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          className={`w-24 rounded border bg-panel px-2 py-1 ${error ? 'border-down' : 'border-line'}`}
          min={f.pct ? f.min * 100 : f.min}
          max={f.pct ? f.max * 100 : f.max}
          step={f.pct ? f.step * 100 : f.step}
          value={shown}
          disabled={!active}
          aria-invalid={error || undefined}
          onChange={(e) => {
            const raw = e.target.value;
            const x = raw === '' ? Number.NaN : Number(raw);
            onChange(f.pct ? x / 100 : x);
          }}
        />
        {f.pct && <span className="text-muted">%</span>}
      </span>
    );
  }
  const label = (
    <label htmlFor={id} className="block">
      {f.label}
      {f.help && <span className="block text-xs text-muted">{f.help}</span>}
    </label>
  );
  return (
    <li className={`py-2 ${active ? '' : 'opacity-50'}`} data-testid={id}>
      <div
        className={
          f.kind === 'bool'
            ? 'flex items-start gap-2'
            : 'flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3'
        }
      >
        {f.kind === 'bool' ? (
          <>
            {input}
            <div className="min-w-0 flex-1">{label}</div>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">{label}</div>
            {input}
          </>
        )}
      </div>
      {(changed || error) && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          {error && f.kind === 'number' && (
            <span className="text-down">
              Fora do permitido: de {num(f.min, f)} a {num(f.max, f)}
              {f.int ? ', sem casas decimais' : ''}.
            </span>
          )}
          {changed && (
            <>
              <span className="rounded bg-panel-2 px-1.5 py-0.5 text-warn">alterado</span>
              <span className="text-muted">padrão: {show(f, def)}</span>
              <button type="button" className="text-accent underline" onClick={() => onChange(def)}>
                voltar ao padrão
              </button>
            </>
          )}
        </p>
      )}
    </li>
  );
}

/**
 * Editor dos parâmetros dos setups (SPEC §8). Vale para o gráfico, alertas, scanner, feedback do treino
 * e laboratório. Os padrões marcados com * na SPEC são arbitrários: mexer até o passado ficar bonito é
 * a forma mais comum de se enganar, e o aviso diz isso logo no topo.
 */
export function SetupParamsPage() {
  const savedRaw = usePrefs((s) => s.setupParams);
  const setSetupParams = usePrefs((s) => s.setSetupParams);
  const saved = useMemo<SetupParams>(() => {
    const r = setupParamsSchema.safeParse(savedRaw ?? {});
    return r.success ? r.data : DEFAULT_SETUP_PARAMS;
  }, [savedRaw]);
  const [draft, setDraft] = useState<SetupParams>(saved);
  const [justSaved, setJustSaved] = useState(false);
  // grupos abertos pelo usuário; um grupo com erro abre sozinho e continua aberto depois de corrigido
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());

  const parsed = setupParamsSchema.safeParse(draft);
  const badPaths = new Set(
    parsed.success ? [] : parsed.error.issues.map((i) => i.path.map(String).join('.')),
  );
  const cross = crossErrors(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const changed = changedPaths(draft);
  const valid = parsed.success && cross.length === 0;

  const update = (path: string, v: unknown) => {
    setDraft((d) => setAt(d, path, v));
    setJustSaved(false);
  };

  return (
    <div className="mx-auto max-w-2xl p-3">
      <h1 className="text-lg font-semibold">Parâmetros dos setups</h1>
      <p className="mt-1 text-sm text-muted">
        Valem para o gráfico, os alertas, o scanner, o feedback do treino e o laboratório.{' '}
        {changed.length === 0
          ? 'Hoje está tudo no padrão.'
          : `${changed.length} ${changed.length === 1 ? 'valor alterado' : 'valores alterados'} em relação ao padrão.`}
      </p>
      <div className="mt-3 rounded border border-warn/60 bg-panel-2 p-3 text-sm" role="note">
        <p className="font-medium text-warn">⚠ Antes de mexer</p>
        <p className="mt-1">
          Os números padrão vêm dos vídeos ou são escolhas nossas, e são <b>arbitrários</b>. Ajustar
          até o resultado do passado ficar bonito é a forma mais comum de se enganar: o resultado
          melhora no teste e piora no dinheiro de verdade. O laboratório conta cada variação que
          você testa e mostra esse número junto com o veredito.
        </p>
        <p className="mt-1">
          Regra prática: decida o valor pelo motivo (o que o setup diz), não pelo lucro do backtest,
          e confira no período de teste e na análise de sensibilidade.{' '}
          <Link to="/biblioteca/expectativa" className="text-accent underline">
            Saiba mais
          </Link>
        </p>
      </div>

      <div className="mt-3 space-y-2">
        {PARAM_GROUPS.map((g) => {
          const n = changed.filter((p) => p.startsWith(`${g.key}.`)).length;
          const gCross = cross.filter((c) => c.group === g.key);
          const gBad = [...badPaths].some((p) => p.startsWith(`${g.key}.`));
          const on = g.key === 'pa' || getAt(draft[g.key], 'enabled') === true;
          return (
            <details
              key={g.key}
              className="rounded border border-line bg-panel"
              data-testid={`group-${g.key}`}
              open={openGroups.has(g.key) || gBad || gCross.length > 0}
              onToggle={(e) => {
                const isOpen = e.currentTarget.open;
                setOpenGroups((prev) => {
                  if (prev.has(g.key) === isOpen) return prev;
                  const next = new Set(prev);
                  if (isOpen) next.add(g.key);
                  else next.delete(g.key);
                  return next;
                });
              }}
            >
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-medium">{g.title}</span>
                {!on && <span className="text-xs text-muted">(desligado)</span>}
                {n > 0 && (
                  <span className="rounded bg-panel-2 px-1.5 py-0.5 text-xs text-warn">
                    {n} {n === 1 ? 'alterado' : 'alterados'}
                  </span>
                )}
                {(gBad || gCross.length > 0) && (
                  <span className="text-xs text-down">✕ corrigir</span>
                )}
              </summary>
              <div className="border-t border-line px-3 pb-2">
                <p className="mt-2 flex items-center gap-2 text-xs text-muted">
                  {g.desc}
                  {g.slug && <HelpLink slug={g.slug} label={`Ajuda: ${g.title}`} />}
                </p>
                {gCross.map((c) => (
                  <p key={c.message} className="mt-2 text-sm text-down">
                    ✕ {c.message}
                  </p>
                ))}
                <ul className="divide-y divide-line">
                  {g.fields.map((f) => {
                    const val = getAt(draft[g.key], f.path);
                    const gate = f.when ? getAt(draft[g.key], f.when.path) === f.when.equals : true;
                    const enabledField = f.path === 'enabled';
                    return (
                      <Field
                        key={f.path}
                        group={g}
                        field={f}
                        value={val}
                        active={enabledField || (on && gate)}
                        error={badPaths.has(`${g.key}.${f.path}`)}
                        onChange={(v) => update(`${g.key}.${f.path}`, v)}
                      />
                    );
                  })}
                </ul>
                {n > 0 && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-accent underline"
                    onClick={() => {
                      setDraft((d) => ({ ...d, [g.key]: DEFAULT_SETUP_PARAMS[g.key] }));
                      setJustSaved(false);
                    }}
                  >
                    Voltar este setup ao padrão
                  </button>
                )}
              </div>
            </details>
          );
        })}
      </div>

      <div className="sticky bottom-2 mt-4 flex flex-wrap items-center gap-2 rounded border border-line bg-panel p-2">
        <button
          type="button"
          disabled={!valid || !dirty}
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          onClick={() => {
            if (!parsed.success || cross.length) return;
            setSetupParams(parsed.data);
            setJustSaved(true);
          }}
        >
          Salvar
        </button>
        <button
          type="button"
          disabled={!dirty}
          className="rounded border border-line px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => setDraft(saved)}
        >
          Desfazer
        </button>
        <button
          type="button"
          disabled={changed.length === 0}
          className="rounded border border-line px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => {
            setDraft(DEFAULT_SETUP_PARAMS);
            setJustSaved(false);
          }}
        >
          Tudo no padrão
        </button>
        <span className="text-xs" aria-live="polite">
          {!valid ? (
            <span className="text-down">Corrija os campos marcados para salvar.</span>
          ) : justSaved && !dirty ? (
            <span className="text-up">
              Salvo. O gráfico usa os novos valores ao ser aberto de novo.
            </span>
          ) : dirty ? (
            <span className="text-muted">Alterações ainda não salvas.</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
