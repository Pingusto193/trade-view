import { formatBRL, formatDateTime, formatNumber } from '@radar/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CdiBox } from '../components/CdiBox';
import { HelpLink } from '../components/HelpLink';
import { cdiBetween } from '../lib/macro';
import { usePaper } from '../lib/paper-store';

/** Treino × CDI no mesmo período: o custo de oportunidade que o vídeo não mostra. */
export function TrainingVsCdi() {
  const { state, loaded, load } = usePaper();
  const [cdi, setCdi] = useState<{ acc: number; days: number; until: number } | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  const a = state?.account;
  const start = a ? (a.resetAt ?? a.createdAt) : null;
  useEffect(() => {
    if (start === null) return;
    void cdiBetween(start, Date.now())
      .then(setCdi)
      .catch(() => setCdi(null));
  }, [start]);
  if (!a || !state) return null;
  const ret = state.equity / a.initialBalance - 1;
  return (
    <section className="rounded border border-line p-3 text-sm" aria-label="Treino contra o CDI">
      <h2 className="font-semibold">
        Seu treino × CDI{' '}
        <HelpLink slug="antes-de-arriscar-dinheiro" label="Ajuda: custo de oportunidade" />
      </h2>
      <p className="text-xs text-muted">
        Conta “{a.name}” desde{' '}
        {formatDateTime(start!)}
      </p>
      <ul className="mt-1 space-y-1">
        <li>
          Treino:{' '}
          <b className={ret >= 0 ? 'text-up' : 'text-down'}>{formatNumber(ret * 100, 2)}%</b> (
          {formatBRL(state.equity - a.initialBalance)}, já com custos; IR não descontado)
        </li>
        <li>
          CDI no mesmo período:{' '}
          {cdi === undefined ? (
            '…'
          ) : cdi === null ? (
            <span className="text-muted">sem dados do Banco Central para esse período</span>
          ) : (
            <>
              <b>{formatNumber(cdi.acc * 100, 2)}%</b> ({formatBRL(a.initialBalance * cdi.acc)}{' '}
              sobre {formatBRL(a.initialBalance)}, antes do IR)
            </>
          )}
        </li>
      </ul>
      {cdi && (
        <p className={`mt-2 text-xs ${ret > cdi.acc ? 'text-up' : 'text-warn'}`}>
          {ret > cdi.acc
            ? 'Até agora o treino rende mais que o CDI. Com poucos trades isso pode ser sorte: veja o tamanho da amostra no diário.'
            : 'Até agora o CDI, sem risco de mercado, rende mais que o treino. Esse é o custo de oportunidade de operar.'}
        </p>
      )}
    </section>
  );
}

/** Contexto Brasil (SPEC §15): Selic, CDI e regras de IR (simuladas, não substituem contador). */
export function BrasilPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3">
      <h1 className="text-xl font-semibold">Brasil: juros e impostos</h1>
      <CdiBox />
      <TrainingVsCdi />
      <section className="rounded border border-line p-3 text-sm" aria-label="Imposto de renda">
        <h2 className="font-semibold">IR em ações e futuros na B3 (regra usada no simulador)</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Swing trade: 15% sobre o lucro líquido do mês.</li>
          <li>Day trade: 20% sobre o lucro líquido do mês.</li>
          <li>
            Isenção só no swing de ações: total VENDIDO no mês até R$ 20.000 (não vale para day
            trade, ETFs e FIIs).
          </li>
          <li>
            IRRF de 0,005% sobre vendas no swing e 1% sobre o lucro do day trade (descontado do
            imposto).
          </li>
          <li>
            Prejuízo só compensa dentro da mesma modalidade. DARF código 6015; abaixo de R$ 10
            acumula.
          </li>
        </ul>
        <p className="mt-2 text-xs text-warn">
          Regras de 2026 confirmadas por fontes secundárias (selo 🟡). Não substitui um contador.
          Cripto: regras em disputa, não simuladas. Ver a apuração mensal no{' '}
          <Link to="/treino" className="underline">
            diário do Treino
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
