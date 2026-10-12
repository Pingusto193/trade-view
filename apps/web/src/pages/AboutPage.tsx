/** Sobre, avisos e atribuições exigidas por licença. */
export function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 text-sm leading-relaxed">
      <h1 className="text-xl font-semibold">Sobre o Radar</h1>
      <p>
        O Radar é uma ferramenta pessoal para <b>ver</b>, <b>avisar</b>, <b>planejar</b>,{' '}
        <b>verificar</b> e <b>treinar</b>. Ele <b>não envia ordens</b> a corretoras e{' '}
        <b>não promete lucro</b>.
      </p>
      <section className="rounded border border-warn/50 bg-warn/10 p-3">
        <h2 className="mb-1 font-semibold text-warn">Antes de arriscar dinheiro</h2>
        <p>
          Estudo de Chague, De-Losso e Giovannetti (2019) com day traders do mercado futuro
          brasileiro: entre os que persistiram por pelo menos 300 dias, <b>97% perderam dinheiro</b>{' '}
          e só 0,4% ganharam mais que um salário de caixa de banco. Compare sempre com o CDI, que
          rende sem esforço nem risco de mercado.
        </p>
      </section>
      <section>
        <h2 className="mb-1 font-semibold">Créditos e licenças</h2>
        <p>
          Gráficos feitos com TradingView Lightweight Charts™ — Copyright © TradingView, Inc. —{' '}
          <a
            className="text-accent underline"
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noreferrer"
          >
            https://www.tradingview.com/
          </a>{' '}
          (licença Apache-2.0).
        </p>
        <p className="mt-1">
          Dados de mercado pertencem às respectivas fontes e são usados apenas para uso pessoal,
          atrás de login, sem redistribuição.
        </p>
      </section>
    </div>
  );
}
