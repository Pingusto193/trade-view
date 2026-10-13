import type { ScanAnalysis, ScanRow } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import { sparkPath } from '../components/Sparkline';
import { sortRows } from './scanner-sort';

function row(symbol: string, a: Partial<ScanAnalysis> | null): ScanRow {
  return {
    symbolId: `x:${symbol}`,
    symbol,
    name: symbol,
    market: 'crypto',
    decimals: 2,
    source: null,
    error: a ? null : 'erro',
    notes: [],
    scannedAt: 0,
    trigger: 'manual',
    analysis: a
      ? ({
          lastClose: 10,
          lastTime: 0,
          bars: 100,
          setups: [],
          higher: null,
          trend: 'lateral',
          adx: null,
          respected: null,
          slopes: { ema9: null, ema21: null, sma50: null, sma200: null },
          weekly: null,
          drawdown: { tf: null, w52: null },
          relVolume: null,
          fundamentals: null,
          spark: [],
          ...a,
        } as ScanAnalysis)
      : null,
  };
}

const order = (rows: ScanRow[]) => rows.map((r) => r.symbol);

describe('ordenação da tabela do scanner', () => {
  const rows = [
    row('BBB', { adx: 30, lastClose: 5, trend: 'baixa' }),
    row('AAA', { adx: 12, lastClose: 50, trend: 'alta' }),
    row('ERR', null),
    row('CCC', { adx: null, lastClose: 7, trend: 'indefinida' }),
    row('DDD', { adx: 30, lastClose: 1, trend: 'alta' }),
  ];

  it('números nas duas direções, empate estável e sem dado sempre no fim', () => {
    expect(order(sortRows(rows, 'adx', 'desc'))).toEqual(['BBB', 'DDD', 'AAA', 'ERR', 'CCC']);
    expect(order(sortRows(rows, 'adx', 'asc'))).toEqual(['AAA', 'BBB', 'DDD', 'ERR', 'CCC']);
    expect(order(sortRows(rows, 'close', 'asc'))).toEqual(['DDD', 'BBB', 'CCC', 'AAA', 'ERR']);
  });

  it('texto em ordem alfabética e tendência pela ordem alta > lateral > baixa', () => {
    expect(order(sortRows(rows, 'symbol', 'asc'))).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'ERR']);
    expect(order(sortRows(rows, 'trend', 'desc'))).toEqual(['AAA', 'DDD', 'BBB', 'ERR', 'CCC']);
  });

  it('setups: o estado mais avançado vem primeiro', () => {
    const hit = (state: 'radar' | 'armado' | 'acionado') => ({
      setup: 's91' as const,
      side: 'buy' as const,
      state,
      trigger: null,
      stop: null,
      target: null,
      entry: null,
      againstHigher: false,
      since: 0,
      reason: '',
      notes: [],
    });
    const s = [
      row('R', { setups: [hit('radar'), hit('radar')] }),
      row('A', { setups: [hit('acionado')] }),
      row('N', { setups: [] }),
      row('M', { setups: [hit('armado')] }),
    ];
    expect(order(sortRows(s, 'setups', 'desc'))).toEqual(['A', 'M', 'R', 'N']);
  });
});

describe('mini-gráfico', () => {
  it('ocupa a área com folga e termina no último fechamento', () => {
    const g = sparkPath([10, 20, 15], 100, 40, 4);
    expect(g.d).toBe('M4.0,36.0 L50.0,4.0 L96.0,20.0');
    expect(g.last).toEqual({ x: 96, y: 20 });
  });

  it('série plana fica no meio; menos de 2 pontos não desenha', () => {
    expect(sparkPath([5, 5, 5], 100, 40).d).toBe('M4.0,20.0 L50.0,20.0 L96.0,20.0');
    expect(sparkPath([5], 100, 40)).toEqual({ d: '', last: null });
  });
});
