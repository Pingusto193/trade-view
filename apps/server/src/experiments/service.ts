import { randomUUID } from 'node:crypto';
import {
  DEFAULT_COSTS,
  bollingerTails,
  costDrag,
  drawdownBuys,
  pooled,
  runBacktest,
  setupParamsSchema,
  welch,
  type BtTrade,
  type PooledR,
  type SetupId,
} from '@radar/core';
import {
  EXPERIMENTS,
  formatNumber,
  type Candle,
  type Comparison,
  type CostsRow,
  type ExperimentId,
  type ExperimentResult,
  type ExperimentRun,
  type NaiveStats,
  type PooledStats,
  type SymbolMeta,
  type SymbolRow,
  type TailsRow,
  type Timeframe,
  type VariantResult,
} from '@radar/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { experimentRuns } from '../db/schema';
import type { MarketService } from '../market/service';

/** Menos que isso não dá nem para aquecer MMA50 e ADX. */
const MIN_BARS = 80;
const CAPITAL = 10_000;
const RISK_PCT = 1;
const TRAIN = 0.7;

interface VariantDef {
  key: string;
  label: string;
  tf: Timeframe;
  bars: number;
  setups: SetupId[];
  params: Record<string, unknown>;
}

const BARS: Record<string, number> = { '1M': 240, '1w': 1040, '1d': 2600, '60m': 5000 };

function e3(): VariantDef[] {
  const out: VariantDef[] = [];
  for (const s of ['s92', 's93'] as const)
    for (const tf of ['1M', '1w', '1d', '60m'] as const)
      out.push({
        key: `${s}-${tf}`,
        label: `${s === 's92' ? '9.2' : '9.3'} — ${{ '1M': 'mensal', '1w': 'semanal', '1d': 'diário', '60m': '60 min' }[tf]}`,
        tf,
        bars: BARS[tf]!,
        setups: [s],
        params: {},
      });
  return out;
}

/** Variantes e comparações (b − a) dos experimentos que rodam o motor de setups. */
const VARIANTS: Partial<
  Record<ExperimentId, { variants: VariantDef[]; comparisons: [string, string, string][] }>
> = {
  e1: {
    variants: [
      {
        key: 'sem',
        label: '9.1 sem o filtro da MMA50',
        tf: '1d',
        bars: 2600,
        setups: ['s91'],
        params: { s91: { trendFilter: false } },
      },
      {
        key: 'com',
        label: '9.1 com o filtro (MMA50 subindo)',
        tf: '1d',
        bars: 2600,
        setups: ['s91'],
        params: { s91: { trendFilter: true } },
      },
    ],
    comparisons: [['sem', 'com', 'Com filtro − sem filtro']],
  },
  e3: {
    variants: e3(),
    comparisons: (['s92', 's93'] as const).flatMap((s): [string, string, string][] => {
      const n = s === 's92' ? '9.2' : '9.3';
      return [
        [`${s}-1d`, `${s}-1w`, `${n}: semanal − diário`],
        [`${s}-1d`, `${s}-1M`, `${n}: mensal − diário`],
        [`${s}-60m`, `${s}-1d`, `${n}: diário − 60 min`],
      ];
    }),
  },
  e4: {
    variants: [
      {
        key: 'livre',
        label: 'Recuo sem exigir "saudável"',
        tf: '1d',
        bars: 2600,
        setups: ['pullback'],
        params: { pullback: { requireHealthy: false } },
      },
      {
        key: 'saudavel',
        label: 'Recuo exigindo "saudável"',
        tf: '1d',
        bars: 2600,
        setups: ['pullback'],
        params: { pullback: { requireHealthy: true } },
      },
    ],
    comparisons: [['livre', 'saudavel', 'Saudável − sem exigir']],
  },
  e5: {
    variants: [
      {
        key: 'padrao',
        label: 'Rompimento com volume ≥ 1,5× (padrão)',
        tf: '1d',
        bars: 2600,
        setups: ['consolidation'],
        params: {},
      },
      {
        key: 'semvol',
        label: 'Rompimento sem exigir volume',
        tf: '1d',
        bars: 2600,
        setups: ['consolidation'],
        params: { consolidation: { requireVolume: false } },
      },
      {
        key: 'reteste',
        label: 'Entrada no reteste (com volume)',
        tf: '1d',
        bars: 2600,
        setups: ['consolidation'],
        params: { consolidation: { entry: 'retest' } },
      },
    ],
    comparisons: [
      ['semvol', 'padrao', 'Com volume − sem volume'],
      ['padrao', 'reteste', 'Reteste − rompimento'],
    ],
  },
};

const stats = (p: PooledR): PooledStats => ({
  trades: p.trades,
  winRate: p.winRate,
  expectancyR: p.expectancyR,
  profitFactorR: p.profitFactorR,
  sample: p.sample,
});

const mean = (xs: readonly number[]) =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const pct = (v: number | null, d = 1) => (v === null ? '—' : `${formatNumber(v * 100, d)}%`);
const r2 = (v: number | null) => (v === null ? '—' : `${formatNumber(v, 2)} R`);

/** Retorno do trade depois dos custos, como fração do valor comprado. */
function tradeReturn(t: BtTrade, pv: number): number {
  const notional = t.entry * t.qty * pv;
  return notional > 0 ? t.pnl / notional : 0;
}

class Notes {
  private set = new Set<string>();
  add(meta: SymbolMeta) {
    for (const n of meta.notes) this.set.add(n);
    if (meta.adjusted === 'no')
      this.set.add(
        `${meta.sourceLabel}: dados SEM ajuste por proventos e desdobramentos (quedas falsas podem gerar sinais).`,
      );
    if (meta.delay.kind === 'simulated') this.set.add('⚠ DADOS SIMULADOS (desenvolvimento).');
  }
  push(s: string) {
    this.set.add(s);
  }
  list() {
    return [...this.set];
  }
}

/**
 * Experimentos prontos (SPEC §12.4). Rodam em segundo plano com os dados reais de cada fonte, um
 * ativo por vez (respeitando os limites das fontes), e guardam a execução inteira.
 */
export class ExperimentService {
  private running = new Map<string, ExperimentRun>();
  /** Dono de cada execução em andamento (uma por usuário). */
  private owners = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly market: MarketService,
    private readonly now: () => number = Date.now,
  ) {
    // execuções que estavam rodando quando o servidor caiu não vão terminar
    const stale = this.db
      .select()
      .from(experimentRuns)
      .where(eq(experimentRuns.status, 'running'))
      .all();
    for (const row of stale) {
      const run = JSON.parse(row.run) as ExperimentRun;
      this.save(row.userId, {
        ...run,
        status: 'error',
        error: 'Interrompido: o servidor reiniciou no meio da execução.',
        finishedAt: this.now(),
      });
    }
  }

  private save(userId: number, run: ExperimentRun) {
    this.db
      .insert(experimentRuns)
      .values({
        id: run.id,
        userId,
        experimentId: run.experimentId,
        createdAt: run.createdAt,
        status: run.status,
        run: JSON.stringify(run),
      })
      .onConflictDoUpdate({
        target: experimentRuns.id,
        set: { status: run.status, run: JSON.stringify(run) },
      })
      .run();
  }

  /** Última execução de cada experimento. */
  latest(userId: number): Partial<Record<ExperimentId, ExperimentRun>> {
    const rows = this.db
      .select()
      .from(experimentRuns)
      .where(eq(experimentRuns.userId, userId))
      .orderBy(desc(experimentRuns.createdAt))
      .all();
    const out: Partial<Record<ExperimentId, ExperimentRun>> = {};
    for (const r of rows) {
      const id = r.experimentId as ExperimentId;
      if (out[id]) continue;
      out[id] = this.running.get(r.id) ?? (JSON.parse(r.run) as ExperimentRun);
    }
    return out;
  }

  get(userId: number, id: string): ExperimentRun | null {
    const row = this.db
      .select()
      .from(experimentRuns)
      .where(and(eq(experimentRuns.userId, userId), eq(experimentRuns.id, id)))
      .get();
    if (!row) return null;
    return this.running.get(id) ?? (JSON.parse(row.run) as ExperimentRun);
  }

  /** Começa um experimento; devolve na hora com status "running". */
  start(userId: number, experimentId: ExperimentId, symbols: string[]): ExperimentRun {
    if ([...this.owners.values()].includes(userId))
      throw new Error('Já existe um experimento rodando. Espere ele terminar.');
    const uniq = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
    const run: ExperimentRun = {
      id: randomUUID(),
      experimentId,
      createdAt: this.now(),
      finishedAt: null,
      status: 'running',
      progress: { done: 0, total: uniq.length },
      symbols: uniq,
      result: null,
      dataNotes: [],
      summary: null,
      error: null,
    };
    this.save(userId, run);
    this.running.set(run.id, run);
    this.owners.set(run.id, userId);
    void this.execute(run)
      .then((r) => {
        run.result = r.result;
        run.summary = r.summary;
        run.dataNotes = r.notes;
        run.status = 'done';
      })
      .catch((err: unknown) => {
        run.status = 'error';
        run.error = (err as Error).message;
      })
      .finally(() => {
        run.finishedAt = this.now();
        this.save(userId, run);
        this.running.delete(run.id);
        this.owners.delete(run.id);
      });
    return { ...run };
  }

  /** Espera a execução terminar (testes). */
  async wait(id: string, timeoutMs = 60_000): Promise<void> {
    const t0 = Date.now();
    while (this.running.has(id) && Date.now() - t0 < timeoutMs)
      await new Promise((ok) => setTimeout(ok, 20));
  }

  private async candles(symbolId: string, tf: Timeframe, bars: number) {
    const resp = await this.market.getCandles(symbolId, tf, bars);
    if (!resp.meta.timeframes.includes(tf)) throw new Error(`a fonte não oferece a escala ${tf}`);
    const candles = resp.lastCandleOpen ? resp.candles.slice(0, -1) : resp.candles;
    if (candles.length < MIN_BARS)
      throw new Error(
        resp.status.state !== 'ok'
          ? `sem dados da fonte: ${resp.status.message ?? 'erro'}`
          : `só ${candles.length} candles (mínimo ${MIN_BARS})`,
      );
    return { candles, meta: resp.meta };
  }

  private async execute(
    run: ExperimentRun,
  ): Promise<{ result: ExperimentResult; summary: string; notes: string[] }> {
    const notes = new Notes();
    const id = run.experimentId;
    const step = () => run.progress.done++;
    if (VARIANTS[id]) return this.variants(id, run.symbols, notes, step);
    if (id === 'e2') return this.tails(run.symbols, notes, step);
    if (id === 'e6') return this.costs(run.symbols, notes, step);
    if (id === 'e7') return this.reflexivity(run.symbols, notes, step);
    throw new Error(`experimento desconhecido: ${id}`);
  }

  private backtest(candles: readonly Candle[], meta: SymbolMeta, v: VariantDef) {
    return runBacktest(candles, {
      setups: v.setups,
      params: setupParamsSchema.parse(v.params),
      tf: v.tf,
      tz: meta.session.timezone,
      meta: {
        tick: meta.tickSize,
        pointValue: meta.pointValue,
        lotSize: meta.lotSize,
        minQty: meta.minQty,
        qtyStep: meta.qtyStep,
        market: meta.market,
      },
      capital: CAPITAL,
      riskPct: RISK_PCT,
      longOnly: true,
    });
  }

  private variantResult(
    v: VariantDef,
    acc: { rs: number[]; test: number[]; rets: number[]; rows: SymbolRow[] },
  ): VariantResult {
    return {
      key: v.key,
      label: v.label,
      tf: v.tf,
      pooled: stats(pooled(acc.rs)),
      test: stats(pooled(acc.test)),
      perSymbol: acc.rows,
      avgReturn: mean(acc.rets),
    };
  }

  private async variants(
    id: ExperimentId,
    symbols: string[],
    notes: Notes,
    step: () => void,
  ): Promise<{ result: ExperimentResult; summary: string; notes: string[] }> {
    const def = VARIANTS[id]!;
    const acc = new Map(
      def.variants.map((v) => [
        v.key,
        { rs: [] as number[], test: [] as number[], rets: [] as number[], rows: [] as SymbolRow[] },
      ]),
    );
    const tfs = [...new Set(def.variants.map((v) => v.tf))];
    for (const symbolId of symbols) {
      for (const tf of tfs) {
        const vs = def.variants.filter((v) => v.tf === tf);
        const bars = Math.max(...vs.map((v) => v.bars));
        try {
          const { candles, meta } = await this.candles(symbolId, tf, bars);
          notes.add(meta);
          const from = candles[0]!.time;
          const to = candles.at(-1)!.time;
          const cut = from + (to - from) * TRAIN;
          for (const v of vs) {
            const r = this.backtest(candles, meta, v);
            const a = acc.get(v.key)!;
            const rs = r.trades.map((t) => t.r);
            a.rs.push(...rs);
            a.test.push(...r.trades.filter((t) => t.entryTime >= cut).map((t) => t.r));
            a.rets.push(...r.trades.map((t) => tradeReturn(t, meta.pointValue)));
            a.rows.push({
              symbolId,
              trades: rs.length,
              expectancyR: mean(rs),
              from,
              to,
              bars: candles.length,
            });
          }
        } catch (err) {
          for (const v of vs)
            acc.get(v.key)!.rows.push({
              symbolId,
              trades: 0,
              expectancyR: null,
              error: (err as Error).message,
            });
        }
      }
      step();
    }
    const variants = def.variants.map((v) => this.variantResult(v, acc.get(v.key)!));
    const comparisons: Comparison[] = def.comparisons.map(([a, b, label]) => {
      const d = welch(acc.get(a)!.rs, acc.get(b)!.rs);
      return {
        a,
        b,
        label,
        diffR: d?.diffR ?? null,
        t: d?.t ?? null,
        meaningful: d?.meaningful ?? false,
      };
    });
    notes.push(
      `Custos padrão de cada mercado, risco de ${RISK_PCT}% por trade, só compras; "teste" = últimos ${Math.round((1 - TRAIN) * 100)}% do período de cada ativo.`,
    );
    // resumo curto: os detalhes de cada comparação aparecem na tela
    const valid = comparisons.filter((c) => c.diffR !== null);
    const real = valid.filter((c) => c.meaningful);
    const trades = variants.map((v) => v.pooled.trades);
    const summary = valid.length
      ? `${real.length} de ${valid.length} ${valid.length === 1 ? 'diferença passou' : 'diferenças passaram'} do barulho do acaso (|t| ≥ 2)${
          real.length
            ? `: ${real.map((c) => `${c.label} ${c.diffR! > 0 ? '+' : ''}${formatNumber(c.diffR!, 2)} R`).join('; ')}`
            : ''
        }. Trades por variante: de ${Math.min(...trades)} a ${Math.max(...trades)}.`
      : 'Amostra insuficiente para comparar as variantes.';
    return { result: { kind: 'variants', variants, comparisons }, summary, notes: notes.list() };
  }

  private async tails(
    symbols: string[],
    notes: Notes,
    step: () => void,
  ): Promise<{ result: ExperimentResult; summary: string; notes: string[] }> {
    const rows: TailsRow[] = [];
    for (const symbolId of symbols) {
      try {
        const { candles, meta } = await this.candles(symbolId, '1d', 2600);
        notes.add(meta);
        rows.push({
          symbolId,
          ...bollingerTails(candles),
          from: candles[0]!.time,
          to: candles.at(-1)!.time,
        });
      } catch (err) {
        rows.push({ symbolId, error: (err as Error).message });
      }
      step();
    }
    const ok = rows.filter((r) => r.closes);
    const closes = ok.reduce((s, r) => s + r.closes!, 0);
    const out = ok.reduce((s, r) => s + r.above! + r.below!, 0);
    const walk = mean(ok.map((r) => r.randomWalkPerSide!));
    const events = ok.reduce((s, r) => s + r.backToMean!.events, 0);
    const within = ok.reduce((s, r) => s + r.backToMean!.within, 0);
    const perSide = closes ? out / closes / 2 : null;
    const summary = closes
      ? `Fechou fora da banda em ${pct(perSide, 2)} dos candles por lado (curva normal: 0,13%; passeio aleatório com a mesma volatilidade: ${pct(walk, 2)}). Tocou a média central em até 10 candles em ${pct(events ? within / events : null, 0)} dos ${events} casos.`
      : 'Nenhum ativo com dados suficientes.';
    return { result: { kind: 'tails', rows }, summary, notes: notes.list() };
  }

  private async costs(
    symbols: string[],
    notes: Notes,
    step: () => void,
  ): Promise<{ result: ExperimentResult; summary: string; notes: string[] }> {
    const rows: CostsRow[] = [];
    const TFS: Timeframe[] = ['5m', '15m', '60m', '1d'];
    for (const symbolId of symbols) {
      for (const tf of TFS) {
        try {
          const { candles, meta } = await this.candles(symbolId, tf, 1000);
          notes.add(meta);
          const day = tf !== '1d';
          const taxRate = meta.market === 'b3' ? (day ? 0.2 : 0.15) : null;
          if (taxRate === null)
            notes.push('IR de cripto, EUA e forex não simulado (resultado antes do imposto).');
          const r = costDrag(candles, {
            costs: DEFAULT_COSTS[meta.market],
            tick: meta.tickSize,
            taxRate: taxRate ?? 0,
          });
          rows.push({ symbolId, tf, modality: day ? 'day trade' : 'swing', taxRate, ...r });
        } catch (err) {
          rows.push({ symbolId, tf, error: (err as Error).message });
        }
      }
      step();
    }
    notes.push(
      'Premissa do vídeo: 40% de acerto e ganho de 2 R; stop típico = 1 × ATR14 (escolha nossa).',
    );
    const byTf = TFS.map((tf) => {
      const rs = rows.filter((r) => r.tf === tf && r.costR !== undefined);
      return {
        tf,
        costR: median(rs.map((r) => r.costR!)),
        net: median(rs.map((r) => r.afterTaxR!)),
      };
    }).filter((x) => x.costR !== null);
    const summary = byTf.length
      ? `Conta do vídeo: +0,20 R por trade antes de custos. Mediana entre os ativos — ${byTf
          .map((x) => `${x.tf}: custo ${r2(x.costR)}, sobra ${r2(x.net)}`)
          .join('; ')}.`
      : 'Nenhum ativo com dados suficientes.';
    return { result: { kind: 'costs', rows }, summary, notes: notes.list() };
  }

  private async reflexivity(
    symbols: string[],
    notes: Notes,
    step: () => void,
  ): Promise<{ result: ExperimentResult; summary: string; notes: string[] }> {
    const v: VariantDef = {
      key: 'reflexividade',
      label: 'Reflexividade (espera o pivô de alta)',
      tf: '1w',
      bars: 1040,
      setups: ['reflexivity'],
      params: {},
    };
    const acc = {
      rs: [] as number[],
      test: [] as number[],
      rets: [] as number[],
      rows: [] as SymbolRow[],
    };
    const naiveAll: { ret: number; worst: number }[] = [];
    const worsts: number[] = [];
    const naivePerSymbol: (NaiveStats & { symbolId: string; error?: string })[] = [];
    const naive = (xs: readonly { ret: number; worst: number }[]): NaiveStats => ({
      buys: xs.length,
      avgReturn: mean(xs.map((x) => x.ret)),
      medianReturn: median(xs.map((x) => x.ret)),
      winRate: xs.length ? xs.filter((x) => x.ret > 0).length / xs.length : null,
      avgWorst: mean(xs.map((x) => x.worst)),
    });
    for (const symbolId of symbols) {
      try {
        const { candles, meta } = await this.candles(symbolId, '1w', 1040);
        notes.add(meta);
        const buys = drawdownBuys(candles, { minDrawdown: 0.5, hold: 52 });
        naiveAll.push(...buys);
        naivePerSymbol.push({ symbolId, ...naive(buys) });
        const r = this.backtest(candles, meta, v);
        const from = candles[0]!.time;
        const to = candles.at(-1)!.time;
        const cut = from + (to - from) * TRAIN;
        for (const t of r.trades) {
          let low = Infinity;
          for (let i = t.entryIndex; i <= t.exitIndex; i++) low = Math.min(low, candles[i]!.low);
          worsts.push(Math.min(0, low / t.entry - 1));
        }
        acc.rs.push(...r.trades.map((t) => t.r));
        acc.test.push(...r.trades.filter((t) => t.entryTime >= cut).map((t) => t.r));
        acc.rets.push(...r.trades.map((t) => tradeReturn(t, meta.pointValue)));
        acc.rows.push({
          symbolId,
          trades: r.trades.length,
          expectancyR: mean(r.trades.map((t) => t.r)),
          from,
          to,
          bars: candles.length,
        });
      } catch (err) {
        const error = (err as Error).message;
        naivePerSymbol.push({ symbolId, error, ...naive([]) });
        acc.rows.push({ symbolId, trades: 0, expectancyR: null, error });
      }
      step();
    }
    notes.push('Fundamentos não verificados: a Reflexividade rodou sem o filtro de LPA e receita.');
    const n = naive(naiveAll);
    const setup = this.variantResult(v, acc);
    const setupAvgWorst = mean(worsts);
    const summary = `Compra a −50%: ${n.buys} compras, retorno médio ${pct(n.avgReturn)} em 52 semanas (sem custos), pior queda média depois da compra ${pct(n.avgWorst)}. Reflexividade: ${setup.pooled.trades} trades, ${r2(setup.pooled.expectancyR)} por trade, retorno médio ${pct(setup.avgReturn)} (com custos), pior queda média ${pct(setupAvgWorst)}.`;
    return {
      result: { kind: 'reflexivity', naive: n, naivePerSymbol, setup, setupAvgWorst },
      summary,
      notes: notes.list(),
    };
  }

  info(id: ExperimentId) {
    return EXPERIMENTS[id];
  }
}
