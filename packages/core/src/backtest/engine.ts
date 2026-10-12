import type { Candle, Market, Timeframe } from '@radar/shared';
import { DEFAULT_COSTS, fees as feeOf, type CostModel } from '../paper/engine';
import { positionSize } from '../risk/position';
import { roundTick } from '../setups/fills';
import { SetupEngine } from '../setups/engine';
import { DEFAULT_SETUP_PARAMS, type SetupParams } from '../setups/params';
import type { ExitKind, SetupEvent, SetupId } from '../setups/types';

/**
 * Backtest barra a barra (SPEC §12.1), orientado a eventos e usando OS MESMOS detectores do app: o
 * motor de setups decide entradas e saídas com o modelo de execução conservador (`fills.ts`); aqui
 * entram o tamanho da posição pelo risco, os custos (spread, derrapagem, taxas) e a contabilidade.
 */

export interface BacktestMeta {
  tick: number;
  pointValue: number;
  lotSize: number;
  minQty: number;
  qtyStep: number;
  market: Market;
}

export interface BacktestConfig {
  setups: readonly SetupId[];
  params?: SetupParams;
  tf: Timeframe;
  tz: string;
  meta: BacktestMeta;
  /** Capital inicial (na moeda do ativo). */
  capital: number;
  /** Risco por trade em % do patrimônio do momento. */
  riskPct: number;
  costs?: CostModel;
  /** Mercados com margem (futuros) podem passar do capital; os outros, não. */
  allowLeverage?: boolean;
  /**
   * Só compras. Vender a descoberto exige aluguel de ações (B3) ou margem/derivativos (cripto),
   * custos que este motor ainda não simula; com vendas ligadas o resultado fica otimista.
   */
  longOnly?: boolean;
}

export interface BtTrade {
  setup: SetupId;
  side: 'buy' | 'sell';
  occurrence: string;
  entryIndex: number;
  entryTime: number;
  exitIndex: number;
  exitTime: number;
  /** Preços "da tela" (do detector) e executados (com spread/derrapagem). */
  signalEntry: number;
  entry: number;
  signalExit: number;
  exit: number;
  stop: number;
  qty: number;
  /** Risco planejado em dinheiro (|entrada − stop| × qtd × valor do ponto). */
  risk: number;
  fees: number;
  /** Resultado líquido (com custos, sem IR). */
  pnl: number;
  /** Resultado em R, líquido de custos. */
  r: number;
  exitKind: ExitKind | 'fim-dos-dados';
  againstHigher: boolean;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface BacktestResult {
  trades: BtTrade[];
  /** Sinais que não viraram trade e por quê (ex.: já posicionado, risco não cabe). */
  skipped: Record<string, number>;
  /** Patrimônio marcado a mercado no fechamento de cada candle. */
  equity: EquityPoint[];
  /** Candles com posição aberta / total (exposição). */
  barsInMarket: number;
  bars: number;
  from: number;
  to: number;
  initialCapital: number;
  /** Comprar no primeiro candle e segurar até o último (com custos de ida e volta). */
  buyHold: { ret: number; qty: number };
}

function adverse(price: number, side: 'buy' | 'sell', tick: number, c: CostModel): number {
  const spread = (price * c.spreadPct) / 2;
  const slip = c.slippageTicks * tick;
  return roundTick(side === 'buy' ? price + spread + slip : price - spread - slip, tick);
}

interface Open {
  ev: SetupEvent;
  entry: number;
  /** Quantidade ainda aberta (diminui com a parcial). */
  qty: number;
  /** Quantidade da entrada (o risco e o registro do trade usam esta). */
  qty0: number;
  stop: number;
  risk: number;
  /** Taxas já pagas (entrada e parciais). */
  fees: number;
  /** Resultado bruto já realizado nas parciais. */
  realized: number;
  entryIndex: number;
}

export function runBacktest(candles: readonly Candle[], cfg: BacktestConfig): BacktestResult {
  const costs = cfg.costs ?? DEFAULT_COSTS[cfg.meta.market];
  const pv = cfg.meta.pointValue;
  const tick = cfg.meta.tick;
  const engine = new SetupEngine({
    params: cfg.params ?? DEFAULT_SETUP_PARAMS,
    tick,
    tf: cfg.tf,
    tz: cfg.tz,
    only: cfg.setups,
  });
  let equity = cfg.capital;
  let open: Open | null = null;
  let barsInMarket = 0;
  const trades: BtTrade[] = [];
  const skipped: Record<string, number> = {};
  const curve: EquityPoint[] = [];
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);

  const closeTrade = (o: Open, signalExit: number, idx: number, kind: BtTrade['exitKind']) => {
    const side = o.ev.side;
    const exitSide = side === 'buy' ? 'sell' : 'buy';
    // alvo é ordem limitada (não derrapa); stop, saída dinâmica e fim dos dados derrapam
    const exit =
      kind === 'alvo' ? roundTick(signalExit, tick) : adverse(signalExit, exitSide, tick, costs);
    const exitFees = feeOf(exit, o.qty, pv, costs);
    const gross = (side === 'buy' ? exit - o.entry : o.entry - exit) * o.qty * pv;
    const totalFees = o.fees + exitFees;
    const pnl = o.realized + gross - totalFees;
    equity += gross - exitFees;
    const c = candles[idx]!;
    trades.push({
      setup: o.ev.setup,
      side,
      occurrence: o.ev.id,
      entryIndex: o.entryIndex,
      entryTime: candles[o.entryIndex]!.time,
      exitIndex: idx,
      exitTime: c.time,
      signalEntry: o.ev.entry ?? o.entry,
      entry: o.entry,
      signalExit,
      exit,
      stop: o.stop,
      qty: o.qty0,
      risk: o.risk,
      fees: totalFees,
      pnl,
      r: o.risk > 0 ? pnl / o.risk : 0,
      exitKind: kind,
      againstHigher: Boolean(o.ev.againstHigher),
    });
  };

  candles.forEach((c, i) => {
    const events = engine.push(c);
    engine.events.length = 0; // o backtest só precisa dos eventos do candle
    for (const ev of events) {
      if (ev.state === 'acionado' && ev.entryIndex === ev.index && ev.price === ev.entry) {
        if (cfg.longOnly && ev.side === 'sell') {
          skip('venda (apostar na queda) desligada');
          continue;
        }
        if (open) {
          skip('já posicionado neste ativo');
          continue;
        }
        if (ev.entry === undefined || ev.stop === undefined) continue;
        const entry = adverse(ev.entry, ev.side, tick, costs);
        const stop = ev.stop;
        if ((ev.side === 'buy' && stop >= entry) || (ev.side === 'sell' && stop <= entry)) {
          skip('custos deixaram o stop do lado errado');
          continue;
        }
        let size;
        try {
          size = positionSize({
            capital: equity,
            riskPct: cfg.riskPct,
            entry,
            stop,
            lotSize: cfg.meta.lotSize,
            minQty: cfg.meta.minQty,
            qtyStep: cfg.meta.qtyStep,
            pointValue: pv,
            fractional: cfg.meta.market === 'b3',
          });
        } catch {
          skip('risco inválido');
          continue;
        }
        let qty = size.quantity;
        // sem alavancagem: o valor comprado precisa caber no patrimônio
        if (!cfg.allowLeverage && qty * entry * pv > equity) {
          const step = cfg.meta.qtyStep || 1;
          qty = Math.floor(equity / (entry * pv) / step + 1e-9) * step;
        }
        if (!(qty >= cfg.meta.minQty) || qty <= 0) {
          skip('risco não cabe no capital');
          continue;
        }
        const fees = feeOf(entry, qty, pv, costs);
        equity -= fees;
        open = {
          ev,
          entry,
          qty,
          qty0: qty,
          stop,
          risk: Math.abs(entry - stop) * qty * pv,
          fees,
          realized: 0,
          entryIndex: i,
        };
      } else if (
        ev.state === 'acionado' &&
        ev.partial !== undefined &&
        open &&
        ev.id === open.ev.id &&
        ev.price !== null
      ) {
        // parcial: ordem limitada (não derrapa), arredondada para o passo de quantidade
        const step = cfg.meta.qtyStep || 1;
        const part = Math.floor((open.qty0 * ev.partial) / step + 1e-9) * step;
        if (part > 0 && part < open.qty) {
          const px = roundTick(ev.price, tick);
          const pf = feeOf(px, part, pv, costs);
          const g = (ev.side === 'buy' ? px - open.entry : open.entry - px) * part * pv;
          open.realized += g;
          open.fees += pf;
          open.qty -= part;
          equity += g - pf;
        }
      } else if (ev.state === 'encerrado' && open && ev.id === open.ev.id && ev.price !== null) {
        closeTrade(open, ev.price, i, ev.exit ?? 'stop');
        open = null;
      }
    }
    if (open) barsInMarket++;
    const o = open as Open | null;
    const mtm = o ? (o.ev.side === 'buy' ? c.close - o.entry : o.entry - c.close) * o.qty * pv : 0;
    curve.push({ time: c.time, equity: equity + mtm });
  });
  const last = candles.length - 1;
  if (open && last >= 0) closeTrade(open, candles[last]!.close, last, 'fim-dos-dados');

  // comprar e segurar, com o mesmo capital e custos de ida e volta
  let buyHold = { ret: 0, qty: 0 };
  if (candles.length > 1) {
    const first = candles[0]!;
    const lastC = candles[last]!;
    const entry = adverse(first.open, 'buy', tick, costs);
    const step = cfg.meta.qtyStep || 1;
    const qty = Math.floor(cfg.capital / (entry * pv) / step + 1e-9) * step;
    if (qty > 0) {
      const exit = adverse(lastC.close, 'sell', tick, costs);
      const pnl =
        (exit - entry) * qty * pv - feeOf(entry, qty, pv, costs) - feeOf(exit, qty, pv, costs);
      buyHold = { ret: pnl / cfg.capital, qty };
    }
  }

  return {
    trades,
    skipped,
    equity: curve,
    barsInMarket,
    bars: candles.length,
    from: candles[0]?.time ?? 0,
    to: candles[last]?.time ?? 0,
    initialCapital: cfg.capital,
    buyHold,
  };
}
