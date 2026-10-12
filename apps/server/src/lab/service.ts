import { createHash, randomUUID } from 'node:crypto';
import {
  DEFAULT_COSTS,
  computeMetrics,
  monteCarlo,
  runBacktest,
  setupParamsSchema,
  splitTrades,
  type BacktestResult,
  type BtTrade,
  type Metrics,
  type SetupParams,
} from '@radar/core';
import {
  formatNumber,
  type LabMetrics,
  type LabRun,
  type LabRunInput,
  type LabRunSummary,
  type LabTrade,
  type LabVerdict,
  type SymbolMeta,
} from '@radar/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { labRuns } from '../db/schema';
import type { MacroService } from '../macro/service';
import type { MarketService } from '../market/service';

/** Parâmetro "*" variado no mapa de sensibilidade de cada setup (SPEC §12.3). */
const SENSITIVITY: Record<string, { path: string[]; values: number[] }> = {
  s91: { path: ['s91', 'exit', 'targetR'], values: [1.5, 2, 2.5, 3] },
  s92: { path: ['s92', 'exit', 'targetR'], values: [1.5, 2, 2.5, 3] },
  s93: { path: ['s93', 'exit', 'targetR'], values: [1.5, 2, 2.5, 3] },
  pullback: { path: ['pullback', 'exit', 'targetR'], values: [1.5, 2, 2.5, 3] },
  consolidation: { path: ['consolidation', 'exit', 'targetR'], values: [1.5, 2, 2.5, 3] },
  elastic: { path: ['elastic', 'bbStdDev'], values: [2.5, 3, 3.5] },
  reflexivity: { path: ['reflexivity', 'minDrawdown'], values: [0.4, 0.5, 0.6] },
};

function getPath(o: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], o);
}

function withPath(p: SetupParams, path: string[], value: number): SetupParams {
  const copy = structuredClone(p) as unknown as Record<string, unknown>;
  let cur = copy;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[path.at(-1)!] = value;
  return copy as unknown as SetupParams;
}

const toLab = (m: Metrics): LabMetrics => ({
  trades: m.trades,
  wins: m.wins,
  winRate: m.winRate,
  payoff: m.payoff,
  expectancyR: m.expectancyR,
  expectancy: m.expectancy,
  profitFactor: m.profitFactor,
  totalReturn: m.totalReturn,
  cagr: m.cagr,
  maxDrawdown: m.maxDrawdown,
  maxDrawdownDays: m.maxDrawdownDays,
  longestLosingStreak: m.longestLosingStreak,
  exposure: m.exposure,
  avgBarsInTrade: m.avgBarsInTrade,
  positiveMonths: m.positiveMonths,
  fees: m.fees,
  tax: m.tax,
  totalReturnAfterTax: m.totalReturnAfterTax,
  sample: m.sample,
});

function monthKey(t: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date(t))
    .slice(0, 7);
}

function histogram(trades: readonly BtTrade[]) {
  const edges = [-Infinity, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 4, Infinity];
  return edges.slice(0, -1).map((from, i) => ({
    from,
    to: edges[i + 1]!,
    count: trades.filter((t) => t.r >= from && t.r < edges[i + 1]!).length,
  }));
}

function downsample<T>(xs: readonly T[], max = 400): T[] {
  if (xs.length <= max) return [...xs];
  const step = xs.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]!);
  out.push(xs.at(-1)!);
  return out;
}

/**
 * Laboratório (SPEC §12): roda o backtest com dados REAIS da fonte, aplica o antiautoengano e guarda
 * TODA execução (o app mostra quantas variações você já testou).
 */
export class LabService {
  constructor(
    private readonly db: Db,
    private readonly market: MarketService,
    private readonly macro: MacroService,
    private readonly now: () => number = Date.now,
  ) {}

  private family(userId: number, symbolId: string, setupsKey: string): number {
    return this.db
      .select({ id: labRuns.id })
      .from(labRuns)
      .where(
        and(
          eq(labRuns.userId, userId),
          eq(labRuns.symbolId, symbolId),
          eq(labRuns.setupsKey, setupsKey),
        ),
      )
      .all().length;
  }

  list(userId: number, limit = 50): LabRunSummary[] {
    return this.db
      .select()
      .from(labRuns)
      .where(eq(labRuns.userId, userId))
      .orderBy(desc(labRuns.createdAt))
      .limit(limit)
      .all()
      .map((r) => {
        const run = JSON.parse(r.result) as LabRun;
        return {
          id: r.id,
          createdAt: r.createdAt,
          symbolId: r.symbolId,
          tf: r.tf,
          setups: r.setupsKey.split(','),
          trades: run.metrics.trades,
          expectancyR: run.metrics.expectancyR,
          verdict: run.verdict.label,
        };
      });
  }

  get(userId: number, id: string): LabRun | null {
    const r = this.db
      .select()
      .from(labRuns)
      .where(and(eq(labRuns.userId, userId), eq(labRuns.id, id)))
      .get();
    return r ? (JSON.parse(r.result) as LabRun) : null;
  }

  async run(userId: number, input: LabRunInput): Promise<LabRun> {
    const params = setupParamsSchema.parse(input.params ?? {});
    const resp = await this.market.getCandles(input.symbolId, input.tf, input.bars);
    const meta: SymbolMeta = resp.meta;
    const candles = resp.lastCandleOpen ? resp.candles.slice(0, -1) : resp.candles;
    if (candles.length < 100) {
      throw new Error(
        resp.status.state !== 'ok'
          ? `Sem dados da fonte agora: ${resp.status.message ?? 'erro'}`
          : `Só ${candles.length} candles fechados: pouco para um backtest (mínimo 100).`,
      );
    }
    const costs = input.costs ?? DEFAULT_COSTS[meta.market];
    const base = {
      setups: input.setups,
      tf: input.tf,
      tz: meta.session.timezone,
      meta: {
        tick: meta.tickSize,
        pointValue: meta.pointValue,
        lotSize: meta.lotSize,
        minQty: meta.minQty,
        qtyStep: meta.qtyStep,
        market: meta.market,
      },
      capital: input.capital,
      riskPct: input.riskPct,
      costs,
      longOnly: !input.allowShort,
    };
    const r: BacktestResult = runBacktest(candles, { ...base, params });
    const taxB3 = meta.market === 'b3';
    const m = computeMetrics(r, { pointValue: meta.pointValue, taxB3 });
    const { cut, train, test } = splitTrades(r, input.trainFraction);
    const mTrain = computeMetrics(r, { pointValue: meta.pointValue, taxB3, trades: train });
    const mTest = computeMetrics(r, { pointValue: meta.pointValue, taxB3, trades: test });

    // sensibilidade: o mesmo teste com o número "*" principal de cada setup (até 2 setups)
    const sensitivity: LabRun['sensitivity'] = [];
    for (const s of input.setups.slice(0, 2)) {
      const sp = SENSITIVITY[s];
      if (!sp) continue;
      const values = sp.values.map((value) => {
        const rr = runBacktest(candles, { ...base, params: withPath(params, sp.path, value) });
        const mm = computeMetrics(rr, { pointValue: meta.pointValue });
        return { value, expectancyR: mm.expectancyR, trades: mm.trades };
      });
      sensitivity.push({ param: sp.path.join('.'), values });
    }

    // CDI do mesmo período (busca o histórico que faltar no BCB)
    await Promise.race([
      this.macro.ensureCdiFrom(r.from),
      new Promise((ok) => setTimeout(ok, 8000).unref?.()),
    ]);
    const cdi = this.macro.cdiBetween(r.from, r.to);
    const mc = monteCarlo(
      r.trades.map((t) => t.r),
      input.riskPct,
      { runs: 5000, seed: 42 },
    );

    const setupsKey = [...input.setups].sort().join(',');
    const attempts = this.family(userId, input.symbolId, setupsKey) + 1;
    const verdict = this.verdict(m, mTest, sensitivity, params, cdi?.acc ?? null, r.buyHold.ret);
    const skippedList = Object.entries(r.skipped);
    if (m.trades === 0 && skippedList.length)
      verdict.reasons.unshift(
        `Nenhum sinal virou trade: ${skippedList.map(([why, n]) => `${why} (${n})`).join('; ')}.` +
          (r.skipped['risco não cabe no capital']
            ? ` Com ${formatNumber(input.capital, 0)} de capital não dá para comprar o lote mínimo deste ativo.`
            : ''),
      );
    const dataNotes = [...meta.notes];
    if (meta.adjusted === 'no')
      dataNotes.push(
        '⚠ Dados SEM ajuste por proventos e desdobramentos: quedas falsas podem gerar sinais e stops que não existiram.',
      );
    if (meta.delay.kind === 'simulated') dataNotes.push('⚠ DADOS SIMULADOS (desenvolvimento).');
    if (input.allowShort)
      dataNotes.push(
        '⚠ Vendas (apostar na queda) incluídas SEM custo de aluguel de ações nem de margem: o resultado fica otimista.',
      );
    if (meta.currency !== 'BRL')
      dataNotes.push(
        `Resultado em ${meta.currency}; o CDI é em reais. A comparação ignora a variação do câmbio no período.`,
      );
    dataNotes.push(
      'Ativo escolhido hoje: testar só ativos que "deram certo" é viés de sobrevivência (os que quebraram ou saíram da bolsa não aparecem).',
    );
    if (attempts > 5)
      dataNotes.push(
        `Você já testou ${attempts} variações deste ativo com estes setups: quanto mais tentativas, mais desconfie do melhor resultado.`,
      );

    const byMonth = new Map<string, number>();
    for (const t of r.trades)
      byMonth.set(monthKey(t.exitTime), (byMonth.get(monthKey(t.exitTime)) ?? 0) + t.pnl);
    const trades: LabTrade[] = r.trades.slice(-500).map((t) => ({
      setup: t.setup,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      entry: t.entry,
      exit: t.exit,
      qty: t.qty,
      pnl: t.pnl,
      r: t.r,
      fees: t.fees,
      exitKind: t.exitKind,
      againstHigher: t.againstHigher,
    }));
    const id = randomUUID();
    const run: LabRun = {
      id,
      createdAt: this.now(),
      input,
      symbol: meta.symbol,
      currency: meta.currency,
      dataNotes,
      from: r.from,
      to: r.to,
      bars: r.bars,
      metrics: toLab(m),
      train: toLab(mTrain),
      test: toLab(mTest),
      cut,
      verdict,
      buyHold: r.buyHold.ret,
      cdi: cdi ? { acc: cdi.acc } : null,
      monteCarlo: mc,
      sensitivity,
      equity: downsample(r.equity),
      monthly: [...byMonth.entries()].map(([month, pnl]) => ({ month, pnl })),
      rHistogram: histogram(r.trades),
      trades,
      skipped: r.skipped,
      attempts,
    };
    this.db
      .insert(labRuns)
      .values({
        id,
        userId,
        createdAt: run.createdAt,
        symbolId: input.symbolId,
        tf: input.tf,
        setupsKey,
        configHash: createHash('sha256')
          .update(JSON.stringify({ ...input, params }))
          .digest('hex'),
        result: JSON.stringify(run),
      })
      .run();
    return run;
  }

  /**
   * Veredito do antiautoengano (SPEC §12.3). "Aprovado" só com: teste fora da amostra positivo depois
   * de custos (e IR na B3), ≥ 30 trades no teste e resultado estável na vizinhança do parâmetro.
   */
  private verdict(
    all: Metrics,
    test: Metrics,
    sens: LabRun['sensitivity'],
    params: SetupParams,
    cdiAcc: number | null,
    buyHold: number,
  ): { label: LabVerdict; reasons: string[] } {
    const reasons: string[] = [];
    const ret = all.totalReturnAfterTax ?? all.totalReturn;
    if (cdiAcc !== null && ret < cdiAcc)
      reasons.push(
        `Rendeu ${formatNumber(ret * 100, 1)}% contra ${formatNumber(cdiAcc * 100, 1)}% do CDI no mesmo período (sem risco de mercado).`,
      );
    if (cdiAcc === null)
      reasons.push(
        'Sem CDI do Banco Central para o período: comparação com a renda fixa indisponível.',
      );
    if (ret < buyHold)
      reasons.push(
        `Comprar e segurar rendeu ${formatNumber(buyHold * 100, 1)}% contra ${formatNumber(ret * 100, 1)}% da estratégia.`,
      );
    if (all.trades < 30) {
      reasons.unshift(
        `Só ${all.trades} trades: menos de 30 é inconclusivo (sorte e azar dominam).`,
      );
      return { label: 'inconclusivo', reasons };
    }
    if ((all.expectancyR ?? 0) <= 0 || ret <= 0) {
      reasons.unshift(
        (all.expectancyR ?? 0) <= 0
          ? 'Expectativa negativa depois dos custos: a estratégia perdeu dinheiro no período.'
          : 'Depois de custos e IR, a estratégia perdeu dinheiro no período.',
      );
      return { label: 'reprovado', reasons };
    }
    if (test.trades < 30) {
      reasons.unshift(
        `Fora da amostra só houve ${test.trades} trades (mínimo 30): não dá para separar estratégia de ajuste ao passado.`,
      );
      return { label: 'evidência fraca', reasons };
    }
    // resultado do teste em dinheiro, depois do IR simulado (o IR pode virar um saldo pequeno)
    const testNet = (test.expectancy ?? 0) * test.trades - (test.tax ?? 0);
    if ((test.expectancyR ?? 0) <= 0 || testNet <= 0) {
      reasons.unshift(
        'Funcionou no treino mas NÃO no teste fora da amostra: sinal clássico de ajuste ao passado.',
      );
      return { label: 'reprovado', reasons };
    }
    // estabilidade: os vizinhos do valor usado também precisam ser positivos
    for (const s of sens) {
      const used = Number(getPath(params, s.param.split('.')));
      const i = s.values.findIndex((v) => v.value === used);
      const neighbors = s.values.filter((_, k) => Math.abs(k - i) === 1);
      if (i >= 0 && neighbors.some((v) => (v.expectancyR ?? -1) <= 0)) {
        reasons.unshift(
          `Resultado instável: mudando ${s.param} um passo para o lado, a expectativa fica negativa (pico isolado, provável sorte).`,
        );
        return { label: 'promissor', reasons };
      }
    }
    if (all.trades < 100) {
      reasons.unshift(`${all.trades} trades: menos de 100 ainda é evidência fraca.`);
      return { label: 'evidência fraca', reasons };
    }
    if (cdiAcc !== null && ret < cdiAcc) return { label: 'promissor', reasons };
    reasons.unshift(
      'Positivo fora da amostra, depois de custos, com amostra e vizinhança estáveis. Ainda assim: passado não garante futuro.',
    );
    return { label: 'aprovado', reasons };
  }
}
