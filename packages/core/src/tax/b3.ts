import { z } from 'zod';

/**
 * Apuração mensal do IR na B3 (SPEC §12.1 e §15). Uma única implementação para o Modo Treino, o diário
 * e o backtest. Regras e fontes em docs/DATA_SOURCES.md §9 (selo 🟡: confirmar com um contador).
 * NÃO substitui um contador.
 */
export const b3TaxParamsSchema = z.object({
  swingRate: z.number().min(0).max(1).default(0.15),
  dayRate: z.number().min(0).max(1).default(0.2),
  /** Isenção do swing de AÇÕES: total vendido no mês até este valor (tudo ou nada). */
  exemptionLimit: z.number().min(0).default(20_000),
  /** IRRF ("dedo-duro") do swing: fração do valor vendido. */
  irrfSwingRate: z.number().min(0).max(0.01).default(0.00005),
  /** IRRF do day trade: fração do lucro do dia. */
  irrfDayRate: z.number().min(0).max(0.1).default(0.01),
  /** DARF abaixo deste valor não é pago: acumula para os meses seguintes. */
  darfMin: z.number().min(0).default(10),
  darfCode: z.string().default('6015'),
  /** Prejuízo de ações em mês isento pode ser compensado depois? (🟡 não verificado: decisão nossa) */
  exemptMonthLossCarries: z.boolean().default(true),
});
export type B3TaxParams = z.infer<typeof b3TaxParamsSchema>;
export const DEFAULT_B3_TAX: B3TaxParams = b3TaxParamsSchema.parse({});

export type Modality = 'swing' | 'day';
/** 'acao' entra na isenção de R$ 20 mil; 'outro' (ETF, futuros, opções) nunca. FII não é modelado. */
export type TaxAssetClass = 'acao' | 'outro';

/** Uma operação encerrada (venda que realiza resultado), já com custos descontados. */
export interface TaxTrade {
  /** Data da operação que realiza o resultado (UTC ms). O mês é calculado em America/Sao_Paulo. */
  time: number;
  modality: Modality;
  assetClass: TaxAssetClass;
  /** Valor total da VENDA (para a isenção e o IRRF do swing). */
  saleValue: number;
  /** Resultado líquido em R$ (lucro positivo, prejuízo negativo), depois de custos. */
  result: number;
}

export interface ModalityMonth {
  result: number;
  /** Lucro isento (só swing de ações em mês com vendas ≤ limite). */
  exempt: number;
  /** Prejuízo acumulado usado neste mês. */
  lossUsed: number;
  /** Prejuízo acumulado que sobra para os próximos meses. */
  lossCarry: number;
  taxable: number;
  tax: number;
  irrf: number;
}

export interface TaxMonth {
  /** "2026-03" */
  month: string;
  swing: ModalityMonth;
  day: ModalityMonth;
  /** Vendas de ações no swing (base da isenção). */
  stockSales: number;
  exemptMonth: boolean;
  /** Imposto do mês depois de descontar o IRRF. */
  due: number;
  /** IRRF que sobrou (maior que o imposto) e fica para compensar depois. */
  irrfCarry: number;
  /** Valor do DARF a pagar neste mês (0 se ficou abaixo do mínimo). */
  darf: number;
  /** Saldo abaixo do mínimo que passa para o próximo mês. */
  pendingBelowMin: number;
  /** Vencimento: último dia útil do mês seguinte (sem feriados — confira). */
  dueMonth: string;
  notes: string[];
}

// criar o formatador é caro (milhares de trades no backtest): um só, reaproveitado
const SP_MONTH = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
});

function monthKey(time: number): string {
  return SP_MONTH.format(new Date(time)).slice(0, 7);
}

function nextMonth(key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function emptyMod(): ModalityMonth {
  return { result: 0, exempt: 0, lossUsed: 0, lossCarry: 0, taxable: 0, tax: 0, irrf: 0 };
}

/**
 * Apura mês a mês, em ordem, carregando prejuízos (por modalidade), IRRF e DARF abaixo do mínimo.
 * Meses sem operação entre o primeiro e o último também aparecem (o saldo pendente segue).
 */
export function apurarB3(
  trades: readonly TaxTrade[],
  params: B3TaxParams = DEFAULT_B3_TAX,
): TaxMonth[] {
  if (trades.length === 0) return [];
  const byMonth = new Map<string, TaxTrade[]>();
  for (const t of trades) {
    const k = monthKey(t.time);
    byMonth.set(k, [...(byMonth.get(k) ?? []), t]);
  }
  const keys = [...byMonth.keys()].sort();
  const out: TaxMonth[] = [];
  let lossSwing = 0;
  let lossDay = 0;
  let irrfCarry = 0;
  let pending = 0;
  for (let k = keys[0]!; k <= keys[keys.length - 1]!; k = nextMonth(k)) {
    const list = byMonth.get(k) ?? [];
    const notes: string[] = [];
    const swing = emptyMod();
    const day = emptyMod();
    let stockSales = 0;
    let stockSwingResult = 0;
    for (const t of list) {
      if (t.modality === 'swing') {
        swing.result += t.result;
        swing.irrf += t.saleValue * params.irrfSwingRate;
        if (t.assetClass === 'acao') {
          stockSales += t.saleValue;
          stockSwingResult += t.result;
        }
      } else {
        day.result += t.result;
        // aproximação: IRRF de 1% sobre o lucro de cada operação de day trade com ganho
        if (t.result > 0) day.irrf += t.result * params.irrfDayRate;
      }
    }
    const exemptMonth = stockSales > 0 && stockSales <= params.exemptionLimit;
    // swing: lucro de ações em mês isento sai da base; prejuízo de ações em mês isento carrega (parâmetro)
    let swingBase = swing.result;
    if (exemptMonth) {
      if (stockSwingResult > 0) {
        swing.exempt = stockSwingResult;
        swingBase -= stockSwingResult;
      } else if (!params.exemptMonthLossCarries) {
        swingBase -= stockSwingResult;
      }
      notes.push(
        `Vendas de ações no swing de R$ ${round2(stockSales)} (até R$ ${params.exemptionLimit}): lucro de ações isento.`,
      );
    }
    const settle = (m: ModalityMonth, base: number, carry: number, rate: number): number => {
      if (base > 0) {
        m.lossUsed = Math.min(carry, base);
        m.taxable = base - m.lossUsed;
        carry -= m.lossUsed;
      } else {
        carry += -base;
      }
      m.lossCarry = carry;
      m.tax = m.taxable * rate;
      return carry;
    };
    lossSwing = settle(swing, swingBase, lossSwing, params.swingRate);
    lossDay = settle(day, day.result, lossDay, params.dayRate);

    const gross = swing.tax + day.tax;
    const irrfAvail = swing.irrf + day.irrf + irrfCarry;
    const due = Math.max(0, gross - irrfAvail);
    irrfCarry = Math.max(0, irrfAvail - gross);
    const total = due + pending;
    let darf = 0;
    if (total >= params.darfMin) {
      darf = total;
      pending = 0;
    } else {
      pending = total;
      if (total > 0)
        notes.push(`DARF abaixo de R$ ${params.darfMin}: o valor passa para o próximo mês.`);
    }
    out.push({
      month: k,
      swing: roundMod(swing),
      day: roundMod(day),
      stockSales: round2(stockSales),
      exemptMonth,
      due: round2(due),
      irrfCarry: round2(irrfCarry),
      darf: round2(darf),
      pendingBelowMin: round2(pending),
      dueMonth: nextMonth(k),
      notes,
    });
  }
  return out;
}

function roundMod(m: ModalityMonth): ModalityMonth {
  return {
    result: round2(m.result),
    exempt: round2(m.exempt),
    lossUsed: round2(m.lossUsed),
    lossCarry: round2(m.lossCarry),
    taxable: round2(m.taxable),
    tax: round2(m.tax),
    irrf: round2(m.irrf),
  };
}
