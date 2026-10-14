import type { TaxMonth } from '@radar/core';
import { formatBRL, formatNumber, formatPercent, type PaperStats } from '@radar/shared';
import { HelpLink } from './HelpLink';

/** Quadro de estatísticas de um diário (treino, replay ou real — mesma conta no core). */
export function StatsGrid({ s }: { s: PaperStats }) {
  return (
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
        value={
          s.maxDrawdownPct > 0
            ? `${formatBRL(s.maxDrawdownBrl)} (${formatNumber(s.maxDrawdownPct, 1)}%)`
            : formatBRL(s.maxDrawdownBrl)
        }
      />
      <Stat
        label="Sem stop"
        value={String(s.withoutStop)}
        tone={s.withoutStop ? 'down' : undefined}
      />
      <Stat
        label="Disciplina"
        value={s.disciplinePct === null ? '—' : `${formatNumber(s.disciplinePct, 0)}%`}
        tone={s.disciplinePct !== null && s.disciplinePct < 90 ? 'down' : undefined}
      />
      <Stat label="Com plano liberado" value={`${s.withPlan} de ${s.trades}`} />
      <Stat
        label="Stop para trás"
        value={String(s.stopMovedBack)}
        tone={s.stopMovedBack ? 'down' : undefined}
      />
    </div>
  );
}

export function SmallSample({ n }: { n: number }) {
  if (n >= 30) return null;
  return (
    <p className="rounded bg-warn/15 p-2 text-xs text-warn">
      Amostra pequena ({n} trades): com menos de 30 o resultado é inconclusivo e com menos de 100 é
      evidência fraca. Sorte e azar ainda dominam.{' '}
      <HelpLink slug="expectativa" label="Ajuda: expectativa e amostra" className="align-middle" />
    </p>
  );
}

export function TaxTable({
  tax,
  title,
  empty,
  note,
}: {
  tax: readonly TaxMonth[];
  title: string;
  empty: string;
  note: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {tax.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
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
            {tax.map((m) => (
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
      <p className="mt-1 text-[11px] text-muted">{note}</p>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}) {
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
