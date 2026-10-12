/**
 * Calculadora de posição pelo risco (SPEC §11). Uma única implementação, usada pela ferramenta de
 * posição do gráfico, pelo plano de trade, pelo Modo Treino e pelo backtest.
 */
export interface PositionInput {
  capital: number;
  /** Risco em % do capital (1 = 1%). */
  riskPct: number;
  entry: number;
  stop: number;
  target?: number;
  /** Lote padrão (B3 ações: 100; cripto: passo mínimo). */
  lotSize: number;
  /** Menor quantidade negociável (B3 fracionário: 1). */
  minQty: number;
  /** Incremento de quantidade (cripto: 0,00001; ações: 1). */
  qtyStep: number;
  /** Valor de 1 ponto de preço por unidade/contrato (ações: 1; WIN: 0,20; WDO: 10). */
  pointValue: number;
  /** Mercado fracionário disponível? (B3 ações: sim, quantidades fora do lote vão para o fracionário) */
  fractional?: boolean;
}

export interface PositionResult {
  side: 'long' | 'short';
  /** Risco por unidade (pontos × valor do ponto). */
  riskPerUnit: number;
  /** Risco máximo permitido em dinheiro. */
  riskBudget: number;
  quantity: number;
  /** Divisão B3: lotes padrão + fracionário. */
  standardLots: number;
  standardQty: number;
  fractionalQty: number;
  allocated: number;
  maxLoss: number;
  gainAtTarget: number | null;
  /** Relação retorno/risco (R:R). */
  rr: number | null;
  warnings: string[];
}

function floorStep(q: number, step: number): number {
  if (step <= 0) return Math.floor(q);
  // corrige erro de ponto flutuante (ex.: 0.3/0.1 = 2.9999999)
  const n = Math.floor(q / step + 1e-9);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number((n * step).toFixed(decimals));
}

export function positionSize(i: PositionInput): PositionResult {
  const warnings: string[] = [];
  if (!(i.capital > 0)) throw new RangeError('capital deve ser positivo');
  if (!(i.riskPct > 0)) throw new RangeError('risco deve ser positivo');
  if (i.entry === i.stop) throw new RangeError('stop igual à entrada: risco zero não existe');
  const side: 'long' | 'short' = i.stop < i.entry ? 'long' : 'short';
  const riskPerUnit = Math.abs(i.entry - i.stop) * i.pointValue;
  const riskBudget = (i.capital * i.riskPct) / 100;
  let quantity = floorStep(riskBudget / riskPerUnit, i.qtyStep);
  if (quantity < i.minQty) {
    warnings.push(
      'Com esse capital e esse stop, nem a quantidade mínima cabe no risco escolhido. Aumente o capital, aproxime o stop ou não opere.',
    );
    quantity = 0;
  }
  let standardLots = Math.floor(quantity / i.lotSize + 1e-9);
  let standardQty = standardLots * i.lotSize;
  let fractionalQty = Number((quantity - standardQty).toFixed(10));
  if (i.fractional === false && fractionalQty > 0) {
    quantity = standardQty;
    fractionalQty = 0;
  }
  if (i.lotSize <= i.qtyStep) {
    standardLots = 0;
    standardQty = quantity;
    fractionalQty = 0;
  }
  // valor financeiro exposto (nos futuros é o nocional, não a margem)
  const allocated = quantity * i.entry * i.pointValue;
  const maxLoss = quantity * riskPerUnit;
  let gainAtTarget: number | null = null;
  let rr: number | null = null;
  if (i.target !== undefined) {
    const reward = (side === 'long' ? i.target - i.entry : i.entry - i.target) * i.pointValue;
    gainAtTarget = quantity * reward;
    rr = reward / riskPerUnit;
    if (rr <= 0) warnings.push('O alvo está do lado errado da entrada.');
    else if (rr < 2)
      warnings.push(`Relação retorno/risco de ${rr.toFixed(2)} — abaixo do mínimo de 2R.`);
  }
  if (allocated > i.capital) {
    warnings.push('O valor alocado passa do capital: exige alavancagem ou margem.');
  }
  return {
    side,
    riskPerUnit,
    riskBudget,
    quantity,
    standardLots,
    standardQty,
    fractionalQty,
    allocated,
    maxLoss,
    gainAtTarget,
    rr,
    warnings,
  };
}

/** Avisos sobre o % de risco escolhido (SPEC §11: padrão 1%, aviso acima de 2%, limite configurável). */
export function riskPctWarnings(riskPct: number, maxRiskPct: number): string[] {
  const w: string[] = [];
  if (riskPct > maxRiskPct)
    w.push(`Risco de ${riskPct}% passa do seu limite de ${maxRiskPct}% por trade.`);
  else if (riskPct > 2) w.push(`Risco de ${riskPct}% por trade está acima de 2%.`);
  return w;
}
