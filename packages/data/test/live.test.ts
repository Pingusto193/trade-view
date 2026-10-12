import { describe, expect, it } from 'vitest';
import { BcbClient, BinanceAdapter, SGS } from '../src';

/**
 * Testes de integração REAIS — só rodam com RADAR_LIVE_TESTS=1 e internet.
 * Comando: `pnpm test:live`. Nunca rodaram no ambiente onde o código foi escrito (sem rede).
 */
const live = Boolean(process.env.RADAR_LIVE_TESTS);

describe.skipIf(!live)('integração real (internet)', () => {
  it('Binance: 10 candles diários de BTCUSDT', async () => {
    const c = await new BinanceAdapter().getCandles({ symbol: 'BTCUSDT', tf: '1d', limit: 10 });
    expect(c).toHaveLength(10);
    expect(c.every((x) => x.high >= x.low && x.volume > 0)).toBe(true);
  }, 30_000);

  it('Binance: metadados de BTCUSDT', async () => {
    const m = await new BinanceAdapter().getMeta('BTCUSDT');
    expect(m.tickSize).toBeGreaterThan(0);
  }, 30_000);

  it('BCB: Meta Selic (432) e CDI (12)', async () => {
    const bcb = new BcbClient();
    const selic = await bcb.getLast(SGS.SELIC_META, 1);
    const cdi = await bcb.getLast(SGS.CDI_DIARIO, 5);
    expect(selic[0]?.value).toBeGreaterThan(0);
    expect(cdi.length).toBe(5);
  }, 30_000);
});
