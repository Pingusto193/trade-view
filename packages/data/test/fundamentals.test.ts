import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeFundamentals } from '@radar/core';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  CVM_SOURCE,
  CvmClient,
  DataSourceError,
  NotConfiguredError,
  SEC_SOURCE,
  SecEdgarClient,
  b3BaseTicker,
  cvmFactsFor,
  normalizeUsTicker,
  parseCompanyFacts,
  parseCompanyTickers,
  parseCsv,
  parseDfpZip,
  parseFcaZip,
  type SecCompanyFactsJson,
} from '../src';
import { fixture } from './helpers';

const D = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const TODAY = D('2026-10-13');
const CVM_FIX = fileURLToPath(new URL('../fixtures/cvm/', import.meta.url));

/** Texto → bytes em ISO-8859-1 (como a CVM publica). */
const latin1 = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const cvmText = (name: string) => readFileSync(`${CVM_FIX}${name}`, 'utf8');

/** Monta o zip anual da DFP a partir das fixtures (índice + DRE consolidada e individual). */
function dfpZip(year: number): Uint8Array {
  const names = [
    `dfp_cia_aberta_${year}.csv`,
    `dfp_cia_aberta_DRE_con_${year}.csv`,
    `dfp_cia_aberta_DRE_ind_${year}.csv`,
  ];
  return zipSync({
    ...Object.fromEntries(names.map((n) => [n, latin1(cvmText(n))])),
    // outros arquivos do zip (ex.: balanço) são ignorados
    [`dfp_cia_aberta_BPA_con_${year}.csv`]: latin1('CNPJ_CIA;CD_CONTA\n1;1\n'),
  });
}

const fcaZip = (year: number) =>
  zipSync({
    [`fca_cia_aberta_valor_mobiliario_${year}.csv`]: latin1(
      cvmText(`fca_cia_aberta_valor_mobiliario_${year}.csv`),
    ),
  });

/** fetch falso que devolve bytes ou JSON por URL e guarda as chamadas. */
function binFetch(routes: Record<string, Uint8Array | object | number>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    const r = Object.entries(routes).find(([k]) => url.endsWith(k))?.[1];
    if (r === undefined) return new Response('não encontrado', { status: 404 });
    if (typeof r === 'number') return new Response('erro', { status: r });
    if (r instanceof Uint8Array) return new Response(new Blob([new Uint8Array(r)]));
    return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
  };
  return Object.assign(fn, { calls });
}

// ------------------------------------------------------------------ SEC EDGAR

describe('SEC EDGAR: company_tickers.json', () => {
  it('lê o objeto {"0": {cik_str, ticker, title}}; repetido = o primeiro vale; CIK inválido fica de fora', () => {
    const m = parseCompanyTickers(fixture('sec-company-tickers.json'));
    expect(m.get('FICTA')).toEqual({ cik: 9990001, ticker: 'FICTA', name: 'FICTICIA ALFA INC' });
    expect(m.has('RUIM')).toBe(false);
    // classe com ponto ou hífen: as duas formas acham a mesma ação
    expect(m.get(normalizeUsTicker('fct.b'))?.cik).toBe(9990002);
    expect(normalizeUsTicker('BRK/B')).toBe('BRK-B');
  });
});

describe('SEC EDGAR: companyfacts → fundamentos', () => {
  const sec = parseCompanyFacts(fixture<SecCompanyFactsJson>('sec-companyfacts-ficticia.json'));

  it('só us-gaap, só relatórios anuais (10-K); LPA em USD/shares e receita em USD', () => {
    expect(sec.name).toBe('FICTICIA ALFA INC');
    expect(sec.notes).toEqual([]);
    expect(
      sec.facts.every((f) => f.doc.startsWith('0009990001-') && !f.doc.endsWith('000010')),
    ).toBe(true); // o 10-Q ficou de fora
    expect(new Set(sec.facts.map((f) => f.concept))).toEqual(
      new Set([
        'EarningsPerShareBasic',
        'RevenueFromContractWithCustomerExcludingAssessedTax',
        'Revenues',
      ]),
    ); // LPA diluído e dei ignorados
    expect(sec.facts.find((f) => f.concept === 'Revenues')?.rank).toBe(2);
  });

  it('hoje: LPA 1,10 → 1,584 em 2 anos = 20% a.a.; receita 900 → 1.000 → 1.100 mi sem queda', () => {
    const r = computeFundamentals(sec.facts, { source: SEC_SOURCE, asOf: TODAY });
    expect(r.epsGrowth2y).toBeCloseTo(0.2, 8);
    expect(r.revenueNoDecline).toBe(true);
    expect(r.periodEnd).toBe(D('2025-12-31'));
    expect(r.filedAt).toBe(D('2026-02-13'));
    expect(r.notes).toBeUndefined();
  });

  it('o 4º trimestre que vem dentro do 10-K não conta como ano', () => {
    const q4 = sec.facts.find((f) => f.end === D('2024-12-31') && f.value === 0.35);
    expect(q4).toBeDefined(); // está nos fatos, mas o core descarta pela duração (3 meses)
    const r = computeFundamentals(sec.facts, { source: SEC_SOURCE, asOf: D('2025-06-01') });
    expect(r.epsGrowth2y).toBeCloseTo(Math.sqrt(1.25) - 1, 8);
  });

  it('em 01/06/2025 só existia o 10-K de 2024 (entregue em 14/02/2025)', () => {
    const r = computeFundamentals(sec.facts, {
      source: SEC_SOURCE,
      asOf: D('2025-06-01'),
      strict: true,
    });
    expect(r.periodEnd).toBe(D('2024-12-31'));
    expect(r.revenueNoDecline).toBe(true);
    expect(r.filedAt).toBe(D('2025-02-14'));
  });

  it('LPA só em outra moeda (EUR/shares) ou só em ifrs-full: não usado, com aviso', () => {
    const r = parseCompanyFacts({
      cik: 9990002,
      entityName: 'FICTICIA BETA',
      facts: {
        'us-gaap': {
          EarningsPerShareBasic: {
            units: {
              'EUR/shares': [
                {
                  start: '2025-01-01',
                  end: '2025-12-31',
                  val: 2,
                  accn: 'x',
                  form: '20-F',
                  filed: '2026-04-01',
                },
              ],
            },
          },
        },
        'ifrs-full': {
          Revenue: {
            units: {
              EUR: [
                {
                  start: '2025-01-01',
                  end: '2025-12-31',
                  val: 9,
                  accn: 'x',
                  form: '20-F',
                  filed: '2026-04-01',
                },
              ],
            },
          },
        },
      },
    });
    expect(r.facts).toEqual([]);
    expect(r.notes).toEqual(['LPA (EarningsPerShareBasic) só em EUR/shares: não usado.']);
    const fu = computeFundamentals(r.facts, { source: SEC_SOURCE, asOf: TODAY });
    expect(fu).toMatchObject({ epsGrowth2y: null, revenueNoDecline: null });
  });
});

describe('SEC EDGAR: cliente', () => {
  it('manda o User-Agent configurado e o CIK com 10 dígitos', async () => {
    const f = binFetch({
      '/files/company_tickers.json': fixture('sec-company-tickers.json'),
      '/api/xbrl/companyfacts/CIK0009990001.json': fixture('sec-companyfacts-ficticia.json'),
    });
    const sec = new SecEdgarClient({ userAgent: 'Radar teste contato@exemplo.com', fetch: f });
    expect(sec.isConfigured()).toBe(true);
    expect((await sec.tickers()).get('FICTA')?.cik).toBe(9990001);
    const facts = await sec.companyFacts(9990001);
    expect(facts.facts.length).toBeGreaterThan(0);
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://www.sec.gov/files/company_tickers.json',
      'https://data.sec.gov/api/xbrl/companyfacts/CIK0009990001.json',
    ]);
    for (const c of f.calls)
      expect(c.headers['User-Agent']).toBe('Radar teste contato@exemplo.com');
  });

  it('sem User-Agent não chama a SEC (exigência dela): "não configurada"', async () => {
    const f = binFetch({});
    const sec = new SecEdgarClient({ userAgent: '  ', fetch: f });
    expect(sec.isConfigured()).toBe(false);
    await expect(sec.tickers()).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(sec.companyFacts(1)).rejects.toThrow(/SEC_USER_AGENT/);
    expect(f.calls).toEqual([]);
  });

  it('empresa sem XBRL (404): erro com o código, sem novas tentativas', async () => {
    const f = binFetch({});
    const sec = new SecEdgarClient({ userAgent: 'x y@z.com', fetch: f, retries: 2 });
    const err = await sec.companyFacts(123).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataSourceError);
    expect((err as DataSourceError).status).toBe(404);
    expect(f.calls).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ CVM

describe('CVM: leitura dos arquivos', () => {
  it('CSV com aspas, ; dentro de aspas, CRLF e BOM', () => {
    expect(parseCsv('﻿A;B\r\n"x;y";"di""z"\r\n\r\n1;\n')).toEqual([
      ['A', 'B'],
      ['x;y', 'di"z'],
      ['1', ''],
    ]);
  });

  it('DFP: lê ISO-8859-1, guarda só receita (3.01) e LPA básico (3.99.01.*), aplica a escala', () => {
    const d = parseDfpZip(dfpZip(2025), 2025);
    expect(d.companies.get('11111111000111')).toBe('EMPRESA FICTÍCIA ALFA S.A.');
    expect(d.companies.get('33333333000133')).toBe('GAMA PARTICIPAÇÕES S.A.');
    const alfa = d.lines.filter((l) => l.cnpj === '11111111000111' && l.statement === 'con');
    expect(alfa.map((l) => l.code).sort()).toEqual([
      '3.01',
      '3.01',
      '3.99.01.01',
      '3.99.01.01',
      '3.99.01.02',
      '3.99.01.02',
    ]); // custo (3.02), totais (3.99, 3.99.01) e LPA diluído (3.99.02.*) ficam de fora
    const rev = alfa.find((l) => l.code === '3.01' && l.end === D('2025-12-31'))!;
    expect(rev.value).toBe(1_210_000_000); // MIL → reais
    expect(rev.label).toBe('Receita de Venda de Bens e/ou Serviços');
    expect(rev.filed).toBe(D('2026-03-20'));
    expect(rev.doc).toBe('11111111000111|2025-12-31|v1');
    // LPA já vem em reais por ação (não multiplica pela escala)
    expect(alfa.find((l) => l.code === '3.99.01.02' && l.end === D('2025-12-31'))!.value).toBe(
      1.584,
    );
    // cada versão com a sua data de recebimento
    const beta = d.lines.filter((l) => l.cnpj === '22222222000122' && l.code === '3.01');
    expect(new Set(beta.map((l) => `${l.doc}@${l.filed}`))).toEqual(
      new Set([
        `22222222000122|2025-12-31|v1@${D('2026-03-25')}`,
        `22222222000122|2025-12-31|v2@${D('2026-05-10')}`,
      ]),
    );
  });

  it('DFP sem a DRE ou zip quebrado: erro claro (nunca "zero")', () => {
    expect(() => parseDfpZip(zipSync({ 'outro.csv': latin1('a') }), 2025)).toThrow(
      /não trouxe a DRE/,
    );
    expect(() => parseDfpZip(latin1('isto não é zip'), 2025)).toThrow(DataSourceError);
  });

  it('FCA: ticker → CNPJ e classe; o que ainda negocia vence o antigo; debênture sem classe', () => {
    const m = parseFcaZip(fcaZip(2026), 2026);
    expect(m.get('FICT3')).toEqual({ ticker: 'FICT3', cnpj: '11111111000111', shareClass: 'ON' });
    expect(m.get('FICT4')?.shareClass).toBe('PN');
    expect(m.get('GAMA5')?.shareClass).toBe('PNA');
    expect(m.get('GAMA11')?.shareClass).toBe('UNIT');
    expect(m.get('DEBX11')?.shareClass).toBeNull();
  });

  it('ticker do fracionário vira o do lote padrão', () => {
    expect(b3BaseTicker('petr4f')).toBe('PETR4');
    expect(b3BaseTicker('TAEE11F')).toBe('TAEE11');
    expect(b3BaseTicker('VALE3')).toBe('VALE3');
  });
});

describe('CVM: DFP → fundamentos', () => {
  const lines = [
    ...parseDfpZip(dfpZip(2024), 2024).lines,
    ...parseDfpZip(dfpZip(2025), 2025).lines,
  ];
  const of = (cnpj: string) => lines.filter((l) => l.cnpj === cnpj);
  const fu = (
    cnpj: string,
    cls: Parameters<typeof cvmFactsFor>[1],
    asOf = TODAY,
    strict = false,
  ) => {
    const c = cvmFactsFor(of(cnpj), cls);
    return {
      ...computeFundamentals(c.facts, { source: CVM_SOURCE, asOf, strict }),
      extra: c.notes,
    };
  };

  it('positivo: ON 1,00 → 1,44 e PN 1,10 → 1,584 = 20% a.a.; receita consolidada sem queda', () => {
    const on = fu('11111111000111', 'ON');
    expect(on.epsGrowth2y).toBeCloseTo(0.2, 8);
    expect(on.revenueNoDecline).toBe(true);
    expect(on.periodEnd).toBe(D('2025-12-31'));
    expect(on.filedAt).toBe(D('2026-03-20'));
    expect(on.extra).toEqual([]);
    expect(fu('11111111000111', 'PN').epsGrowth2y).toBeCloseTo(0.2, 8);
  });

  it('a consolidada vence a individual (a individual de 2025 sozinha não muda nada)', () => {
    const c = cvmFactsFor(of('11111111000111'), 'ON');
    expect(c.facts.filter((f) => f.concept.startsWith('ind:')).every((f) => f.rank === 1)).toBe(
      true,
    );
    expect(c.facts.filter((f) => f.concept.startsWith('con:')).every((f) => f.rank === 0)).toBe(
      true,
    );
  });

  it('banco: só individual, prejuízo em 2025 (LPA negativo) e receita reapresentada com queda', () => {
    const b = fu('22222222000122', 'PN');
    expect(b.epsNegative).toBe(true);
    expect(b.epsGrowth2y).toBeNull();
    expect(b.revenueNoDecline).toBe(false); // versão 2: 74 bi < 75 bi
    expect(b.extra[0]).toMatch(/Receitas da Intermediação Financeira/);
    // antes da reapresentação (10/05/2026), valia a versão 1 (80 bi): sem queda
    const before = fu('22222222000122', 'PN', D('2026-04-01'), true);
    expect(before.revenueNoDecline).toBe(true);
    expect(before.epsNegative).toBe(true);
  });

  it('borda: só 2 exercícios (uma DFP) → LPA nulo; receita que caiu já é verificável', () => {
    const g = fu('33333333000133', 'PNA');
    expect(g.epsGrowth2y).toBeNull();
    expect(g.notes?.[0]).toMatch(/menos de 3 exercícios anuais/);
    expect(g.revenueNoDecline).toBe(false);
  });

  it('units e classe desconhecida: sem LPA, com o motivo', () => {
    const u = fu('33333333000133', 'UNIT');
    expect(u.epsGrowth2y).toBeNull();
    expect(u.extra).toEqual(['LPA: units juntam ações ON e PN; a CVM não publica LPA por unit.']);
    expect(fu('33333333000133', null).extra[0]).toMatch(/classe da ação não identificada/);
  });

  it('classe PNA sem linha "PNA" usa a única linha de preferenciais; PN nunca casa com PNA', () => {
    const relabeled = of('33333333000133').map((l) =>
      l.code === '3.99.01.02' ? { ...l, label: 'PN' } : l,
    );
    expect(cvmFactsFor(relabeled, 'PNA').facts.some((f) => f.metric === 'eps')).toBe(true);
    // ticker PN e linha PNA: aceita por ser a única preferencial do documento
    expect(cvmFactsFor(of('33333333000133'), 'PN').facts.some((f) => f.metric === 'eps')).toBe(
      true,
    );
    // duas preferenciais (PNA e PNB) e ticker PN: não adivinha
    const two = of('33333333000133').flatMap((l) =>
      l.code === '3.99.01.02' ? [l, { ...l, code: '3.99.01.03', label: 'PNB' }] : [l],
    );
    expect(cvmFactsFor(two, 'PN').facts.some((f) => f.metric === 'eps')).toBe(false);
  });
});

describe('CVM: cliente', () => {
  it('baixa os zips da DFP e do FCA nos endereços oficiais', async () => {
    const f = binFetch({
      '/DFP/DADOS/dfp_cia_aberta_2025.zip': dfpZip(2025),
      '/FCA/DADOS/fca_cia_aberta_2026.zip': fcaZip(2026),
    });
    const cvm = new CvmClient({ fetch: f });
    expect((await cvm.dfp(2025)).lines.length).toBeGreaterThan(0);
    expect((await cvm.fca(2026)).get('FICT3')?.cnpj).toBe('11111111000111');
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_2025.zip',
      'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_2026.zip',
    ]);
  });

  it('arquivo que ainda não existe (404) vira erro da fonte', async () => {
    const cvm = new CvmClient({ fetch: binFetch({}) });
    await expect(cvm.dfp(2030)).rejects.toMatchObject({ status: 404 });
  });
});
