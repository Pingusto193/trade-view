import { apurarB3, type TaxTrade } from '../tax/b3';
import type { BacktestResult, BtTrade, EquityPoint } from './engine';

/** Métricas da SPEC §12.2, depois de custos (e de IR quando simulado). */
export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /** Ganho médio ÷ perda média (em módulo). */
  payoff: number | null;
  /** Média de R por trade, líquida de custos. */
  expectancyR: number | null;
  /** Média em dinheiro por trade, líquida de custos. */
  expectancy: number | null;
  /** Soma dos ganhos ÷ soma das perdas (em módulo). */
  profitFactor: number | null;
  totalReturn: number;
  /** Retorno anualizado (composto) no período. */
  cagr: number | null;
  maxDrawdown: number;
  /** Duração da pior queda, do topo até recuperar (ou até o fim), em dias. */
  maxDrawdownDays: number;
  longestLosingStreak: number;
  /** Fração dos candles com posição aberta. */
  exposure: number;
  avgBarsInTrade: number | null;
  /** Fração dos meses (com trade encerrado) que fecharam positivos. */
  positiveMonths: number | null;
  fees: number;
  /** IR simulado (só B3) e resultado depois dele. */
  tax: number | null;
  totalReturnAfterTax: number | null;
  /** Rótulo honesto do tamanho da amostra (SPEC §12.3). */
  sample: 'inconclusivo' | 'evidência fraca' | 'amostra razoável';
}

const DAY = 86_400_000;

export function sampleLabel(n: number): Metrics['sample'] {
  if (n < 30) return 'inconclusivo';
  if (n < 100) return 'evidência fraca';
  return 'amostra razoável';
}

// criar o formatador é caro (milhares de trades): um só de cada, reaproveitado
const SP_MONTH = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
});
const SP_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });

function monthKey(t: number): string {
  return SP_MONTH.format(new Date(t)).slice(0, 7);
}

function spDate(t: number): string {
  return SP_DATE.format(new Date(t));
}

/** Maior queda do patrimônio (fração do topo) e quanto tempo levou para recuperar. */
export function drawdown(curve: readonly EquityPoint[]): { max: number; days: number } {
  let peak = -Infinity;
  let peakTime = 0;
  let max = 0;
  let days = 0;
  let inDd: { start: number; depth: number } | null = null;
  for (const p of curve) {
    if (p.equity >= peak) {
      if (inDd) days = Math.max(days, (p.time - inDd.start) / DAY);
      inDd = null;
      peak = p.equity;
      peakTime = p.time;
      continue;
    }
    const dd = peak > 0 ? (peak - p.equity) / peak : 0;
    if (!inDd) inDd = { start: peakTime, depth: dd };
    inDd.depth = Math.max(inDd.depth, dd);
    max = Math.max(max, dd);
  }
  if (inDd && curve.length) days = Math.max(days, (curve.at(-1)!.time - inDd.start) / DAY);
  return { max, days: Math.round(days) };
}

/** IR simulado da B3 para os trades (day trade = entrada e saída no mesmo dia em São Paulo). */
export function b3Tax(trades: readonly BtTrade[], pointValue: number): number {
  const taxTrades: TaxTrade[] = trades.map((t) => ({
    time: t.exitTime,
    modality: spDate(t.entryTime) === spDate(t.exitTime) ? 'day' : 'swing',
    assetClass: 'acao',
    saleValue: (t.side === 'buy' ? t.exit : t.entry) * t.qty * pointValue,
    result: t.pnl,
  }));
  const months = apurarB3(taxTrades);
  // imposto efetivamente pago (DARFs) + o que ficou pendente abaixo do mínimo no fim
  return months.reduce((s, m) => s + m.darf, 0) + (months.at(-1)?.pendingBelowMin ?? 0);
}

export function computeMetrics(
  r: BacktestResult,
  opts: { pointValue: number; taxB3?: boolean; trades?: readonly BtTrade[] } = { pointValue: 1 },
): Metrics {
  const trades = opts.trades ?? r.trades;
  const n = trades.length;
  const winsT = trades.filter((t) => t.pnl > 0);
  const lossesT = trades.filter((t) => t.pnl <= 0);
  const sum = (xs: readonly BtTrade[]) => xs.reduce((s, t) => s + t.pnl, 0);
  const avgWin = winsT.length ? sum(winsT) / winsT.length : null;
  const avgLoss = lossesT.length ? sum(lossesT) / lossesT.length : null;
  let streak = 0;
  let longest = 0;
  for (const t of trades) {
    streak = t.pnl <= 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const byMonth = new Map<string, number>();
  for (const t of trades)
    byMonth.set(monthKey(t.exitTime), (byMonth.get(monthKey(t.exitTime)) ?? 0) + t.pnl);
  const endEquity = r.equity.at(-1)?.equity ?? r.initialCapital;
  const totalReturn = endEquity / r.initialCapital - 1;
  const years = (r.to - r.from) / (365.25 * DAY);
  const dd = drawdown(r.equity);
  const tax = opts.taxB3 ? b3Tax(trades, opts.pointValue) : null;
  return {
    trades: n,
    wins: winsT.length,
    losses: lossesT.length,
    winRate: n ? winsT.length / n : null,
    avgWin,
    avgLoss,
    payoff: avgWin !== null && avgLoss !== null && avgLoss < 0 ? avgWin / Math.abs(avgLoss) : null,
    expectancyR: n ? trades.reduce((s, t) => s + t.r, 0) / n : null,
    expectancy: n ? sum(trades) / n : null,
    profitFactor: lossesT.length && sum(lossesT) < 0 ? sum(winsT) / Math.abs(sum(lossesT)) : null,
    totalReturn,
    cagr: years > 0.25 && endEquity > 0 ? (endEquity / r.initialCapital) ** (1 / years) - 1 : null,
    maxDrawdown: dd.max,
    maxDrawdownDays: dd.days,
    longestLosingStreak: longest,
    exposure: r.bars ? r.barsInMarket / r.bars : 0,
    avgBarsInTrade: n ? trades.reduce((s, t) => s + (t.exitIndex - t.entryIndex + 1), 0) / n : null,
    positiveMonths: byMonth.size
      ? [...byMonth.values()].filter((v) => v > 0).length / byMonth.size
      : null,
    fees: trades.reduce((s, t) => s + t.fees, 0),
    tax,
    totalReturnAfterTax: tax === null ? null : (endEquity - tax) / r.initialCapital - 1,
    sample: sampleLabel(n),
  };
}

/** Separação cronológica treino/teste (SPEC §12.3: 70/30*). */
export function splitTrades(
  r: BacktestResult,
  trainFraction = 0.7,
): { cut: number; train: BtTrade[]; test: BtTrade[] } {
  const cut = r.from + (r.to - r.from) * trainFraction;
  return {
    cut,
    train: r.trades.filter((t) => t.entryTime < cut),
    test: r.trades.filter((t) => t.entryTime >= cut),
  };
}
