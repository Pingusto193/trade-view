import { describe, expect, it } from 'vitest';
import {
  canonicalUrl,
  delayStats,
  findDuplicate,
  interestTags,
  newsMatches,
  sameStory,
  tagText,
  titleTokens,
} from '../src';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 26, 12);
const keys = (text: string, lang: 'pt' | 'en' = 'pt') =>
  tagText(text, [], lang).map((t) => `${t.type}:${t.value}`);

describe('URL canônica', () => {
  it('ignora www, rastreio, /amp, barra final e ordem dos parâmetros', () => {
    expect(
      canonicalUrl('https://www.exemplo.com/mercados/noticia-1/amp/?utm_source=x&b=2&a=1#topo'),
    ).toBe('exemplo.com/mercados/noticia-1?a=1&b=2');
    expect(canonicalUrl('http://exemplo.com/mercados/noticia-1')).toBe(
      'exemplo.com/mercados/noticia-1',
    );
  });
  it('texto que não é URL volta como está', () => {
    expect(canonicalUrl(' não é url ')).toBe('não é url');
  });
});

describe('deduplicação', () => {
  const a = {
    id: 'a',
    url: 'https://fonte-a.com/x',
    title: 'Copom mantém Selic em 15% e sinaliza cortes em 2027',
    publishedAt: T0,
    arrivedAt: T0 + 60_000,
  };
  it('títulos quase iguais em fontes diferentes, perto no tempo: mesma notícia', () => {
    const b = {
      ...a,
      id: 'b',
      url: 'https://fonte-b.com/y',
      title: 'Copom mantém a Selic em 15% e sinaliza cortes para 2027',
    };
    expect(sameStory(a, b)).toBe(true);
    expect(findDuplicate(b, [a])).toBe('a');
  });
  it('mesmo título dias depois: notícia nova (ex.: reunião seguinte)', () => {
    const b = { ...a, id: 'b', url: 'https://fonte-b.com/z', publishedAt: T0 + 50 * H };
    expect(sameStory(a, b)).toBe(false);
  });
  it('títulos curtos demais não são comparados (evita juntar "Ibovespa sobe")', () => {
    const x = { ...a, id: 'x', url: 'https://f.com/1', title: 'Ibovespa sobe' };
    const y = { ...a, id: 'y', url: 'https://g.com/2', title: 'Ibovespa sobe' };
    expect(titleTokens(x.title).size).toBeLessThan(4);
    expect(sameStory(x, y)).toBe(false);
  });
  it('mesma URL com rastreio diferente: mesma notícia, mesmo com título editado', () => {
    const b = { ...a, id: 'b', url: 'https://fonte-a.com/x?utm_medium=rss', title: 'Outro título' };
    expect(sameStory(a, b)).toBe(true);
  });
});

describe('associação a ativos', () => {
  it('códigos da B3, nomes de empresa e setor', () => {
    const k = keys('Petrobras (PETR4) sobe com petróleo; Itaú Unibanco recua');
    expect(k).toEqual(
      expect.arrayContaining([
        'ticker:PETR4',
        'ticker:PETR3',
        'setor:petroleo',
        'ticker:ITUB4',
        'setor:bancos',
      ]),
    );
  });
  it('"vale a pena" NÃO é a Vale; "mineradora Vale" é', () => {
    expect(keys('Vale a pena investir agora?')).not.toContain('ticker:VALE3');
    expect(keys('Ações da mineradora Vale caem com minério de ferro')).toEqual(
      expect.arrayContaining(['ticker:VALE3', 'setor:mineracao']),
    );
  });
  it('macro: Copom/Selic, dólar, Fed, payroll', () => {
    expect(keys('Copom decide Selic hoje; dólar sobe')).toEqual(
      expect.arrayContaining(['macro:juros-br', 'moeda:USD']),
    );
    expect(keys('Fed holds rates; payroll beats estimates', 'en')).toEqual(
      expect.arrayContaining(['macro:juros-us', 'macro:emprego-us']),
    );
  });
  it('"juros nos EUA" é juros-us, não juros-br', () => {
    const k = keys('Juros nos EUA pressionam emergentes');
    expect(k).toContain('macro:juros-us');
    expect(k).not.toContain('macro:juros-br');
  });
  it('"CPI" em português é comissão parlamentar; em inglês é inflação', () => {
    expect(keys('CPI das bets ouve executivos')).not.toContain('macro:inflacao-us');
    expect(keys('US CPI rises 0.3% in September', 'en')).toContain('macro:inflacao-us');
    expect(keys('CPI dos EUA vem acima do esperado')).toContain('macro:inflacao-us');
  });
  it('"Banco Central" não é setor de bancos', () => {
    expect(keys('Banco Central publica ata')).not.toContain('setor:bancos');
  });
  it('EUA: cashtag e (NASDAQ: X); "US$ 100" não vira ticker', () => {
    expect(keys('Nvidia (NASDAQ: NVDA) and $AAPL rally', 'en')).toEqual(
      expect.arrayContaining(['ticker:NVDA', 'ticker:AAPL']),
    );
    expect(keys('Receita de US$ 100 bilhões').filter((x) => x.startsWith('ticker'))).toEqual([]);
  });
});

describe('interesse por ativo', () => {
  const t = (type: string, value: string) => ({ type, value }) as never;
  it('mini-dólar recebe dólar e macro; mini-índice recebe Ibovespa e macro', () => {
    expect(newsMatches([t('moeda', 'USD')], interestTags('mt5:WDOZ26'))).toBe(true);
    expect(newsMatches([t('macro', 'juros-br')], interestTags('mt5:WINZ26'))).toBe(true);
    expect(newsMatches([t('indice', 'IBOV')], interestTags('mt5:WDOZ26'))).toBe(false);
  });
  it('ação: o código e o da outra classe da mesma empresa', () => {
    const i = interestTags('brapi:PETR4');
    expect(newsMatches([t('ticker', 'PETR3')], i)).toBe(true);
    expect(newsMatches([t('ticker', 'VALE3')], i)).toBe(false);
  });
  it('código de 6 letras que não é par de moedas continua sendo código de ativo', () => {
    expect(interestTags('sim:SIMBTC')).toEqual([{ type: 'ticker', value: 'SIMBTC' }]);
    expect(newsMatches([t('moeda', 'BTC')], interestTags('sim:SIMBTC'))).toBe(false);
  });
  it('cripto e pares de moeda', () => {
    expect(newsMatches([t('cripto', 'BTC')], interestTags('binance:BTCUSDT'))).toBe(true);
    expect(newsMatches([t('moeda', 'EUR')], interestTags('fx:EURUSD'))).toBe(true);
    expect(newsMatches([t('macro', 'juros-us')], interestTags('fx:USDBRL'))).toBe(true);
  });
});

describe('atraso por fonte', () => {
  it('ignora acervo, sem data e relógio adiantado; mediana e p90', () => {
    const s = (min: number | null, backlog = false) => ({
      publishedAt: min === null ? null : T0,
      arrivedAt: T0 + (min ?? 0) * 60_000,
      backlog,
    });
    const r = delayStats([
      s(1),
      s(2),
      s(3),
      s(4),
      s(10),
      s(500, true), // acervo
      s(null), // sem data
      { publishedAt: T0 + 30 * 60_000, arrivedAt: T0, backlog: false }, // 30 min "no futuro"
      { publishedAt: T0 + 60_000, arrivedAt: T0, backlog: false }, // 1 min: tolerado como 0
    ]);
    expect(r.n).toBe(6);
    expect(r.skewed).toBe(1);
    expect(r.medianMs).toBe(2.5 * 60_000);
    expect(r.p90Ms).toBeCloseTo(7 * 60_000, 6);
  });
  it('sem amostra: nulos', () => {
    expect(delayStats([])).toEqual({ n: 0, medianMs: null, p90Ms: null, skewed: 0 });
  });
});
