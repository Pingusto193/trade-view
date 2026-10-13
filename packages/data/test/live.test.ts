import { describe, expect, it } from 'vitest';
import { computeFundamentals } from '@radar/core';
import {
  BcbClient,
  BinanceAdapter,
  CVM_SOURCE,
  CvmClient,
  SEC_SOURCE,
  SGS,
  SecEdgarClient,
  cvmFactsFor,
} from '../src';

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

  // SEC exige identificação com contato: SEC_USER_AGENT="Seu nome seu@email" pnpm test:live
  it.skipIf(!process.env.SEC_USER_AGENT)(
    'SEC EDGAR: ticker → CIK e companyfacts da Apple (AAPL)',
    async () => {
      const sec = new SecEdgarClient({ userAgent: process.env.SEC_USER_AGENT });
      const cik = (await sec.tickers()).get('AAPL')?.cik;
      expect(cik).toBeGreaterThan(0);
      const facts = await sec.companyFacts(cik!);
      const fu = computeFundamentals(facts.facts, { source: SEC_SOURCE, asOf: Date.now() });
      expect(fu.periodEnd).toBeGreaterThan(Date.now() - 550 * 86_400_000);
      expect(fu.revenueNoDecline === null).toBe(false);
    },
    60_000,
  );

  it('CVM: FCA (ticker → CNPJ) e DFP do ano passado para a PETR4', async () => {
    const cvm = new CvmClient();
    const y = new Date().getUTCFullYear();
    const map = await cvm.fca(y).catch(() => cvm.fca(y - 1));
    const petr = map.get('PETR4');
    expect(petr?.cnpj).toMatch(/^\d{14}$/);
    const lines = [...(await cvm.dfp(y - 2)).lines, ...(await cvm.dfp(y - 1)).lines].filter(
      (l) => l.cnpj === petr!.cnpj,
    );
    const { facts } = cvmFactsFor(lines, petr!.shareClass);
    const fu = computeFundamentals(facts, { source: CVM_SOURCE, asOf: Date.now() });
    expect(fu.revenueNoDecline === null && fu.epsGrowth2y === null).toBe(false);
  }, 300_000);
});
