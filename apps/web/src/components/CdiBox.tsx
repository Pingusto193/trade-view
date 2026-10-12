import { formatNumber, formatSessionDate } from '@radar/shared';
import { useEffect } from 'react';
import { useBrasil } from '../lib/macro';

const pct = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined ? '—' : `${formatNumber(x * 100, d)}%`;

/** Selic e CDI atuais do Banco Central (SPEC §15). Nunca inventa: sem dado, mostra o erro. */
export function CdiBox({ compact = false }: { compact?: boolean }) {
  const { data, error, load } = useBrasil();
  useEffect(() => {
    void load();
  }, [load]);
  const box = 'my-3 rounded border border-line bg-panel-2 px-3 py-2 text-sm';
  if (error && !data)
    return (
      <div className={box} role="note" data-testid="cdi-box">
        <p className="font-semibold">CDI e Selic</p>
        <p className="text-down">Não foi possível consultar o servidor: {error}</p>
      </div>
    );
  if (!data)
    return (
      <div className={box} data-testid="cdi-box">
        Consultando o Banco Central…
      </div>
    );
  return (
    <div className={box} role="note" data-testid="cdi-box">
      <p className="font-semibold">CDI e Selic agora</p>
      {data.cdi ? (
        <ul className={`mt-1 ${compact ? 'space-y-0.5' : 'space-y-1'}`}>
          <li>
            CDI: <b>{formatNumber(data.cdi.annualPct, 2)}% ao ano</b> (taxa de{' '}
            {formatSessionDate(data.cdi.date)}, anualizada em 252 dias úteis)
          </li>
          <li>
            CDI acumulado em 12 meses: <b>{pct(data.cdi.acc12m)}</b> · no ano:{' '}
            {pct(data.cdi.accYtd)}
          </li>
        </ul>
      ) : (
        <p className="text-muted">CDI ainda sem dados guardados.</p>
      )}
      {data.selic && (
        <p className="mt-1">
          Meta Selic (Copom): <b>{formatNumber(data.selic.value, 2)}% ao ano</b> (desde{' '}
          {formatSessionDate(data.selic.date)})
        </p>
      )}
      {data.status.state === 'error' && (
        <p className="mt-1 text-xs text-warn">
          ⚠ {data.status.message}
          {data.status.lastValidAt
            ? ` Mostrando o último dado válido, de ${formatSessionDate(data.status.lastValidAt)}.`
            : ''}
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted">
        Fonte: {data.source}. Rendimento do CDI é antes do imposto de renda da renda fixa.
      </p>
    </div>
  );
}
