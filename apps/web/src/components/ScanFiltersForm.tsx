import { SETUP_LABEL } from '@radar/core';
import {
  DISTORTION_FILTERS,
  RESPECT_MAS,
  SCAN_MAS,
  SCAN_MA_LABEL,
  SCAN_SETUP_IDS,
  SCAN_STATES,
  SLOPE_DIRS,
  WEEKLY_MAS,
  formatNumber,
  type ScanFilters,
  type ScanMa,
  type ScanSetupId,
  type ScanState,
  type SlopeDir,
  type TrendValue,
  type WeeklyMa,
} from '@radar/shared';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { libraryPath } from '../library/catalog';

const STATE_TEXT: Record<ScanState, string> = {
  radar: 'Radar',
  armado: 'Armado',
  acionado: 'Acionado',
};
const TRENDS: TrendValue[] = ['alta', 'baixa', 'lateral'];

/** Quantos critérios estão ligados (para o resumo). */
export function countFilters(f: ScanFilters): number {
  return (
    (f.setup ? 1 : 0) +
    (f.trend ? 1 : 0) +
    (f.adxMin !== undefined ? 1 : 0) +
    (f.respected ? 1 : 0) +
    (f.slopes?.length ?? 0) +
    (f.minDrawdown ? 1 : 0) +
    (f.minRelVolume !== undefined ? 1 : 0) +
    (f.fundamentals ? 1 : 0)
  );
}

function toggle<T>(list: readonly T[] | undefined, v: T): T[] {
  const cur = list ?? [];
  return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
}

/** Tira chaves vazias: filtro ausente = não filtra. */
function clean(f: ScanFilters): ScanFilters {
  const out: ScanFilters = { ...f };
  if (!out.setup?.ids.length) delete out.setup;
  if (!out.trend?.length) delete out.trend;
  if (!out.respected?.length) delete out.respected;
  if (!out.slopes?.length) delete out.slopes;
  if (out.adxMin === undefined || Number.isNaN(out.adxMin)) delete out.adxMin;
  if (out.minRelVolume === undefined || Number.isNaN(out.minRelVolume)) delete out.minRelVolume;
  if (
    out.fundamentals &&
    out.fundamentals.minEpsGrowth === undefined &&
    !out.fundamentals.revenueNoDecline
  )
    delete out.fundamentals;
  return out;
}

/** Número digitado em PT-BR ("1,5") ou vazio (= desligado). */
function parseNum(s: string): number | undefined {
  const t = s.trim().replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Texto do número com até 2 casas, sem zeros à toa ("25", "1,5", "20,25"). */
function numText(v: number | undefined): string {
  if (v === undefined) return '';
  const d = Number.isInteger(v) ? 0 : Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? 1 : 2;
  return formatNumber(v, d).replace(/\./g, '');
}

function Chip({
  on,
  onClick,
  children,
  label,
}: {
  on: boolean;
  onClick(): void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs ${on ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted'}`}
    >
      {children}
    </button>
  );
}

function Group({
  title,
  active,
  children,
}: {
  title: string;
  active: number;
  children: ReactNode;
}) {
  return (
    <details className="rounded border border-line" open={active > 0 || undefined}>
      <summary className="cursor-pointer px-2 py-1.5 text-sm">
        {title}
        {active > 0 && <span className="ml-1 text-xs text-accent">({active})</span>}
      </summary>
      <div className="space-y-2 border-t border-line p-2">{children}</div>
    </details>
  );
}

const same = (a: number | undefined, b: number | undefined) =>
  a === b || (a !== undefined && b !== undefined && Math.abs(a - b) < 1e-9);

/**
 * Campo numérico em PT-BR. Guarda o texto digitado ("1," no meio da digitação) e só o reescreve quando o
 * valor muda por fora (filtro pronto, limpar).
 */
function NumField({
  label,
  value,
  onChange,
  suffix,
  hint,
}: {
  label: string;
  value: number | undefined;
  onChange(v: number | undefined): void;
  suffix?: string;
  hint?: string;
}) {
  const [text, setText] = useState(() => numText(value));
  const [seen, setSeen] = useState(value);
  if (!same(value, seen)) {
    setSeen(value);
    if (!same(parseNum(text), value)) setText(numText(value));
  }
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span className="min-w-36">{label}</span>
      <input
        inputMode="decimal"
        className="w-20 rounded border border-line bg-panel px-2 py-1 text-sm text-text"
        value={text}
        placeholder="—"
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseNum(e.target.value));
        }}
      />
      {suffix && <span>{suffix}</span>}
      {hint && <span className="basis-full text-[11px]">{hint}</span>}
    </label>
  );
}

const SLOPE_TEXT: Record<SlopeDir, string> = {
  subindo: 'subindo',
  descendo: 'descendo',
  plana: 'plana',
};

/**
 * Montagem dos filtros do scanner (SPEC §14), em PT-BR simples e pensada para o celular: cada grupo
 * abre e fecha; campo vazio = sem filtro. O resultado é refiltrado na hora (o core aplica de novo).
 */
export function ScanFiltersForm({
  value,
  onChange,
}: {
  value: ScanFilters;
  onChange(f: ScanFilters): void;
}) {
  const set = (patch: Partial<ScanFilters>) => onChange(clean({ ...value, ...patch }));
  const setup = value.setup;
  const slopeOf = (scale: 'tf' | '1w', ma: ScanMa | WeeklyMa) =>
    value.slopes?.find((s) => s.scale === scale && s.ma === ma)?.dir ?? '';
  const setSlope = (scale: 'tf' | '1w', ma: ScanMa | WeeklyMa, dir: SlopeDir | '') => {
    const rest = (value.slopes ?? []).filter((s) => !(s.scale === scale && s.ma === ma));
    const next = dir
      ? [
          ...rest,
          scale === 'tf'
            ? { scale: 'tf' as const, ma: ma as ScanMa, dir }
            : { scale: '1w' as const, ma: ma as WeeklyMa, dir },
        ]
      : rest;
    set({ slopes: next });
  };
  const total = countFilters(value);
  const fu = value.fundamentals;

  return (
    <div className="space-y-2" aria-label="Filtros">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded border border-accent px-2 py-1 text-xs text-accent"
          onClick={() => onChange(structuredClone(DISTORTION_FILTERS))}
        >
          Distorção (reflexividade)
        </button>
        <button
          type="button"
          className="rounded border border-line px-2 py-1 text-xs text-muted disabled:opacity-50"
          disabled={total === 0}
          onClick={() => onChange({})}
        >
          Limpar filtros
        </button>
        <span className="text-xs text-muted">
          {total === 0
            ? 'Sem filtros: mostra todos.'
            : `${total} critério(s): precisa cumprir todos.`}
        </span>
      </div>

      <Group title="Setup" active={setup ? 1 : 0}>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Setups">
          {SCAN_SETUP_IDS.map((id: ScanSetupId) => (
            <Chip
              key={id}
              on={Boolean(setup?.ids.includes(id))}
              onClick={() =>
                set({
                  setup: {
                    states: setup?.states ?? [...SCAN_STATES],
                    side: setup?.side ?? 'any',
                    withHigher: setup?.withHigher ?? false,
                    ids: toggle(setup?.ids, id),
                  },
                })
              }
            >
              {SETUP_LABEL[id]}
            </Chip>
          ))}
        </div>
        {setup && (
          <>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Estados">
              {SCAN_STATES.map((st) => (
                <Chip
                  key={st}
                  on={setup.states.includes(st)}
                  onClick={() => {
                    const states = toggle(setup.states, st);
                    if (states.length) set({ setup: { ...setup, states } });
                  }}
                >
                  {STATE_TEXT[st]}
                </Chip>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              Lado
              <select
                className="rounded border border-line bg-panel px-2 py-1 text-sm text-text"
                value={setup.side}
                onChange={(e) =>
                  set({ setup: { ...setup, side: e.target.value as 'buy' | 'sell' | 'any' } })
                }
              >
                <option value="any">Compra e venda</option>
                <option value="buy">Só compra</option>
                <option value="sell">Só venda</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={setup.withHigher}
                onChange={(e) => set({ setup: { ...setup, withHigher: e.target.checked } })}
              />
              Deixar de fora quem vai contra a escala maior (aviso vermelho)
            </label>
          </>
        )}
      </Group>

      <Group
        title="Tendência e força"
        active={(value.trend ? 1 : 0) + (value.adxMin !== undefined ? 1 : 0)}
      >
        <div className="flex flex-wrap gap-1" role="group" aria-label="Tendência">
          {TRENDS.map((t) => (
            <Chip
              key={t}
              on={Boolean(value.trend?.includes(t))}
              onClick={() => set({ trend: toggle(value.trend, t) })}
            >
              {t}
            </Chip>
          ))}
        </div>
        <NumField
          label="ADX mínimo"
          value={value.adxMin}
          onChange={(n) => set({ adxMin: n })}
          hint="Abaixo de 20 o mercado está lateral; acima de 25, em tendência."
        />
      </Group>

      <Group title="Médias" active={(value.respected ? 1 : 0) + (value.slopes?.length ?? 0)}>
        <p className="text-xs text-muted">
          Média que o ativo respeita (segurou os últimos recuos):
        </p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Média respeitada">
          {RESPECT_MAS.map((m) => (
            <Chip
              key={m}
              on={Boolean(value.respected?.includes(m))}
              onClick={() => set({ respected: toggle(value.respected, m) })}
            >
              {SCAN_MA_LABEL[m]}
            </Chip>
          ))}
        </div>
        <p className="text-xs text-muted">
          Inclinação (subindo, descendo ou plana pela inclinação em 5 candles ÷ ATR):
        </p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
          {[
            ...SCAN_MAS.map((m) => ['tf', m] as const),
            ...WEEKLY_MAS.map((m) => ['1w', m] as const),
          ].map(([scale, ma]) => (
            <label
              key={`${scale}:${ma}`}
              className="flex items-center justify-between gap-1 text-xs text-muted"
            >
              {SCAN_MA_LABEL[ma]}
              {scale === '1w' ? ' semanal' : ''}
              <select
                className="rounded border border-line bg-panel px-1 py-0.5 text-xs text-text"
                value={slopeOf(scale, ma)}
                onChange={(e) => setSlope(scale, ma, e.target.value as SlopeDir | '')}
              >
                <option value="">qualquer</option>
                {SLOPE_DIRS.map((d) => (
                  <option key={d} value={d}>
                    {SLOPE_TEXT[d]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </Group>

      <Group
        title="Queda e volume"
        active={(value.minDrawdown ? 1 : 0) + (value.minRelVolume !== undefined ? 1 : 0)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <NumField
            label="Queda mínima desde o topo"
            value={value.minDrawdown ? value.minDrawdown.value * 100 : undefined}
            suffix="%"
            onChange={(n) => {
              set({
                minDrawdown:
                  n === undefined || n <= 0 || n >= 100
                    ? undefined
                    : { ref: value.minDrawdown?.ref ?? '52w', value: n / 100 },
              });
            }}
          />
          <select
            aria-label="Topo de referência"
            className="rounded border border-line bg-panel px-2 py-1 text-xs text-text"
            value={value.minDrawdown?.ref ?? '52w'}
            disabled={!value.minDrawdown}
            onChange={(e) =>
              value.minDrawdown &&
              set({ minDrawdown: { ...value.minDrawdown, ref: e.target.value as 'tf' | '52w' } })
            }
          >
            <option value="52w">de 52 semanas</option>
            <option value="tf">de 52 candles desta escala</option>
          </select>
        </div>
        <NumField
          label="Volume relativo mínimo"
          value={value.minRelVolume}
          suffix="× a média de 21"
          onChange={(n) => set({ minRelVolume: n })}
        />
      </Group>

      <Group title="Fundamentos" active={fu ? 1 : 0}>
        <NumField
          label="LPA crescendo pelo menos"
          value={fu?.minEpsGrowth !== undefined ? fu.minEpsGrowth * 100 : undefined}
          suffix="% ao ano (2 anos)"
          onChange={(n) => {
            set({
              fundamentals: {
                ...(fu?.revenueNoDecline ? { revenueNoDecline: true as const } : {}),
                ...(n !== undefined && n >= 0 ? { minEpsGrowth: n / 100 } : {}),
              },
            });
          }}
        />
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={Boolean(fu?.revenueNoDecline)}
            onChange={(e) =>
              set({
                fundamentals: {
                  ...(fu?.minEpsGrowth !== undefined ? { minEpsGrowth: fu.minEpsGrowth } : {}),
                  ...(e.target.checked ? { revenueNoDecline: true as const } : {}),
                },
              })
            }
          />
          Receita sem queda
        </label>
        <p className="text-[11px] text-warn">
          Balanços anuais da SEC (EUA) e da CVM (B3). Sem dado (cripto, ETF, unit, histórico curto
          ou fonte fora do ar), o ativo aparece à parte como “fundamentos não verificados” — nunca
          como aprovado.{' '}
          <Link to={libraryPath('reflexividade')} className="text-accent underline">
            Reflexividade na Biblioteca
          </Link>
        </p>
      </Group>
    </div>
  );
}
