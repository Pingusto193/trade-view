import { HelpLink } from '../components/HelpLink';
import { PositionCalculator } from '../components/PositionCalculator';

/** Calculadora de posição avulsa (SPEC §11), útil também para trades reais. */
export function CalculatorPage() {
  return (
    <div className="mx-auto max-w-xl space-y-3 p-3">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        Calculadora de posição
        <HelpLink slug="gestao-de-risco" label="Ajuda: gestão de risco" />
      </h1>
      <p className="text-xs text-muted">
        Quanto comprar para que, se o stop for atingido, a perda seja só o risco escolhido. A conta
        não inclui custos nem a diferença de preço na execução (slippage): num gap a perda pode ser
        maior.
      </p>
      <PositionCalculator />
    </div>
  );
}
