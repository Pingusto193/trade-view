import type { AssetTag, AssetTagType } from '@radar/shared';

/**
 * Notícias — lógica pura (ADR-0032): URL canônica, deduplicação, associação a ativos por regras e atraso
 * por fonte. Heurísticas declaradas: a associação é por palavras e códigos, não entende o texto.
 */

// ------------------------------------------------------------------ URL e título

const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$|cmpid$|origin$|amp$|from$)/i;

/** URL canônica para comparar a mesma matéria vinda de feeds diferentes. */
export function canonicalUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const path = u.pathname.replace(/\/amp\/?$|\.amp$/i, '').replace(/\/+$/, '') || '/';
  const q = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  return `${host}${path}${q}`;
}

const STOP = new Set(
  (
    'a o os as de do da dos das e em no na nos nas um uma uns umas por para com sem que se ao aos ' +
    'the of and to in on for at by with from is are was be as an or after over'
  ).split(' '),
);

/** Palavras significativas do título (sem acento, minúsculas, sem palavras vazias). */
export function titleTokens(title: string): Set<string> {
  const norm = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  return new Set(norm.split(' ').filter((w) => w.length >= 2 && !STOP.has(w)));
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface DedupeCandidate {
  id: string;
  url: string;
  title: string;
  publishedAt: number | null;
  arrivedAt: number;
}

/** Limites da deduplicação (nossos, ADR-0032). */
export const DEDUPE = { minJaccard: 0.75, minTokens: 4, windowMs: 36 * 3_600_000 } as const;

/** Mesma matéria: mesma URL canônica, ou títulos quase iguais publicados perto um do outro. */
export function sameStory(a: DedupeCandidate, b: DedupeCandidate): boolean {
  if (canonicalUrl(a.url) === canonicalUrl(b.url)) return true;
  const ta = titleTokens(a.title);
  const tb = titleTokens(b.title);
  if (ta.size < DEDUPE.minTokens || tb.size < DEDUPE.minTokens) return false;
  const t = (x: DedupeCandidate) => x.publishedAt ?? x.arrivedAt;
  if (Math.abs(t(a) - t(b)) > DEDUPE.windowMs) return false;
  return jaccard(ta, tb) >= DEDUPE.minJaccard;
}

/** Id da primeira notícia igual entre as recentes (null = é nova). */
export function findDuplicate(
  item: DedupeCandidate,
  recent: readonly DedupeCandidate[],
): string | null {
  for (const r of recent) if (r.id !== item.id && sameStory(item, r)) return r.id;
  return null;
}

// ------------------------------------------------------------------ associação a ativos

interface Company {
  tickers: string[];
  /** Padrões do nome (sem acento, minúsculas). Nomes que são palavras comuns só com contexto. */
  names: RegExp[];
  setor?: string;
}

/** Dicionário curto de empresas (priorizadas pelo peso no Ibovespa e pela watchlist padrão). */
const COMPANIES: readonly Company[] = [
  { tickers: ['PETR4', 'PETR3'], names: [/\bpetrobras\b/], setor: 'petroleo' },
  // "vale" é palavra comum ("vale a pena"): só com contexto
  {
    tickers: ['VALE3'],
    names: [/\bmineradora vale\b/, /\bvale s\.?a\b/, /\bacoes da vale\b/],
    setor: 'mineracao',
  },
  { tickers: ['ITUB4'], names: [/\bitau( unibanco)?\b/], setor: 'bancos' },
  { tickers: ['BBDC4'], names: [/\bbradesco\b/], setor: 'bancos' },
  { tickers: ['BBAS3'], names: [/\bbanco do brasil\b/], setor: 'bancos' },
  { tickers: ['ABEV3'], names: [/\bambev\b/] },
  { tickers: ['WEGE3'], names: [/\bweg\b/] },
  { tickers: ['MGLU3'], names: [/\bmagazine luiza\b/, /\bmagalu\b/] },
  { tickers: ['ELET3'], names: [/\beletrobras\b/] },
  { tickers: ['SUZB3'], names: [/\bsuzano\b/] },
  { tickers: ['GGBR4'], names: [/\bgerdau\b/] },
  { tickers: ['AAPL'], names: [/\bapple\b/] },
  { tickers: ['MSFT'], names: [/\bmicrosoft\b/] },
  { tickers: ['NVDA'], names: [/\bnvidia\b/] },
  { tickers: ['TSLA'], names: [/\btesla\b/] },
  { tickers: ['AMZN'], names: [/\bamazon\b/] },
  { tickers: ['GOOGL'], names: [/\balphabet\b/, /\bgoogle\b/] },
  { tickers: ['META'], names: [/\bmeta platforms\b/] },
];

const RULES: readonly { type: AssetTagType; value: string; re: RegExp }[] = [
  { type: 'moeda', value: 'USD', re: /\bdolar(es)?\b|\bcambio\b|\bdollar\b|\busd\b/ },
  { type: 'moeda', value: 'EUR', re: /\beuro\b|\beur\b/ },
  { type: 'indice', value: 'IBOV', re: /\bibovespa\b|\bibov\b|\bbolsa brasileira\b/ },
  { type: 'indice', value: 'SPX', re: /\bs&p ?500\b|\bnasdaq\b|\bdow jones\b|\bwall street\b/ },
  { type: 'macro', value: 'juros-br', re: /\bcopom\b|\bselic\b|\bjuros\b(?! (nos|dos) eua)/ },
  { type: 'macro', value: 'inflacao-br', re: /\bipca\b|\bigp-?m\b|\binflacao\b(?! (nos|dos) eua)/ },
  {
    type: 'macro',
    value: 'fiscal-br',
    re: /\barcabouco\b|\btesouro nacional\b|\bdivida publica\b|\bmeta fiscal\b/,
  },
  {
    type: 'macro',
    value: 'juros-us',
    re: /\bfomc\b|\bfederal reserve\b|\bfed\b|\bpowell\b|\btreasur(y|ies)\b|\bjuros (nos|dos) eua\b/,
  },
  {
    // em português "CPI" quase sempre é Comissão Parlamentar de Inquérito: só com contexto
    type: 'macro',
    value: 'inflacao-us',
    re: /\bcpi (dos eua|americano|norte-americano)\b|\bconsumer price\b|\binflacao (nos|dos) eua\b/,
  },
  {
    type: 'macro',
    value: 'emprego-us',
    re: /\bpayroll\b|\bnonfarm\b|\bjobless\b|\bemprego (nos|dos) eua\b/,
  },
  { type: 'cripto', value: 'BTC', re: /\bbitcoin\b|\bbtc\b/ },
  { type: 'cripto', value: 'ETH', re: /\bethereum\b|\bether\b/ },
  {
    type: 'setor',
    value: 'petroleo',
    re: /\bpetroleo\b|\bbrent\b|\bopep\+?\b|\bopec\+?\b|\bcrude\b/,
  },
  { type: 'setor', value: 'mineracao', re: /\bminerio de ferro\b|\biron ore\b/ },
  { type: 'setor', value: 'bancos', re: /\bbancos?\b(?! central)/ },
];

const B3_TICKER = /\b([A-Z]{4}(?:3|4|5|6|11))\b/g;
const US_CASHTAG = /\$([A-Z]{1,5})\b/g;
const US_EXCHANGE = /\((?:NASDAQ|NYSE|Nasdaq|NYSE American)\s*:\s*([A-Z]{1,5})\)/g;

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Regras que só valem em textos em inglês (siglas que em português significam outra coisa). */
const EN_ONLY: readonly { type: AssetTagType; value: string; re: RegExp }[] = [
  { type: 'macro', value: 'inflacao-us', re: /\bcpi\b|\bpce\b/ },
];

/** Etiquetas de ativos de um texto (título + trecho). Sem repetição, em ordem estável. */
export function tagText(
  text: string,
  extra: readonly AssetTag[] = [],
  lang: 'pt' | 'en' = 'pt',
): AssetTag[] {
  const out = new Map<string, AssetTag>();
  const add = (type: AssetTagType, value: string) => out.set(`${type}:${value}`, { type, value });
  for (const t of extra) add(t.type, t.value);
  for (const m of text.matchAll(B3_TICKER)) add('ticker', m[1] as string);
  for (const m of text.matchAll(US_CASHTAG)) add('ticker', m[1] as string);
  for (const m of text.matchAll(US_EXCHANGE)) add('ticker', m[1] as string);
  const p = plain(text);
  for (const c of COMPANIES) {
    if (c.names.some((re) => re.test(p))) {
      for (const t of c.tickers) add('ticker', t);
      if (c.setor) add('setor', c.setor);
    }
  }
  for (const r of RULES) if (r.re.test(p)) add(r.type, r.value);
  if (lang === 'en') for (const r of EN_ONLY) if (r.re.test(p)) add(r.type, r.value);
  return [...out.values()];
}

/** Moedas reconhecidas nos pares de forex (um código de 6 letras qualquer não é par). */
const CURRENCIES = new Set([
  'USD',
  'EUR',
  'BRL',
  'JPY',
  'GBP',
  'CHF',
  'AUD',
  'CAD',
  'NZD',
  'CNY',
  'MXN',
  'ARS',
  'CLP',
  'ZAR',
]);

/**
 * Etiquetas que interessam a um ativo do Radar (`fonte:CÓDIGO`). Mini-índice e mini-dólar recebem os
 * temas que costumam movê-los (índice, juros, inflação, fiscal, dólar) — heurística declarada.
 */
export function interestTags(symbolId: string): AssetTag[] {
  const code = (symbolId.split(':')[1] ?? symbolId).toUpperCase();
  const t = (type: AssetTagType, value: string): AssetTag => ({ type, value });
  const BR_MACRO = [t('macro', 'juros-br'), t('macro', 'inflacao-br'), t('macro', 'fiscal-br')];
  const US_MACRO = [t('macro', 'juros-us'), t('macro', 'inflacao-us'), t('macro', 'emprego-us')];
  if (/^(WIN|IND)/.test(code)) return [t('indice', 'IBOV'), ...BR_MACRO, ...US_MACRO];
  if (/^(WDO|DOL)/.test(code) || code === 'USDBRL')
    return [t('moeda', 'USD'), ...BR_MACRO, ...US_MACRO];
  if (/^(BTC|ETH)/.test(code)) return [t('cripto', code.slice(0, 3)), t('macro', 'juros-us')];
  if (
    /^[A-Z]{6}$/.test(code) &&
    CURRENCIES.has(code.slice(0, 3)) &&
    CURRENCIES.has(code.slice(3))
  ) {
    // par de moedas (EURUSD, GBPJPY…); só com as duas metades sendo moedas conhecidas
    const tags = [t('moeda', code.slice(0, 3)), t('moeda', code.slice(3, 6))];
    if (code.includes('USD')) tags.push(...US_MACRO);
    return tags;
  }
  const company = COMPANIES.find((c) => c.tickers.includes(code));
  const tags = [t('ticker', code)];
  if (company) {
    for (const x of company.tickers) if (x !== code) tags.push(t('ticker', x));
    if (company.setor) tags.push(t('setor', company.setor));
  }
  return tags;
}

/** A notícia interessa a algum dos ativos? */
export function newsMatches(tags: readonly AssetTag[], interest: readonly AssetTag[]): boolean {
  const want = new Set(interest.map((x) => `${x.type}:${x.value}`));
  return tags.some((x) => want.has(`${x.type}:${x.value}`));
}

// ------------------------------------------------------------------ atraso por fonte

export interface DelaySample {
  publishedAt: number | null;
  arrivedAt: number;
  backlog: boolean;
}

/** Tolerância para relógio da fonte adiantado (publicação "no futuro"). */
const SKEW_MS = 5 * 60_000;

const quantile = (sorted: readonly number[], q: number): number => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
};

/**
 * Atraso = chegada − publicação, só das notícias que chegaram depois de o Radar começar a ler a fonte
 * (acervo fica de fora) e com data de publicação. Publicação mais de 5 min "no futuro" = relógio errado
 * da fonte: fica de fora e é contada à parte.
 */
export function delayStats(samples: readonly DelaySample[]): {
  n: number;
  medianMs: number | null;
  p90Ms: number | null;
  skewed: number;
} {
  const d: number[] = [];
  let skewed = 0;
  for (const s of samples) {
    if (s.backlog || s.publishedAt === null) continue;
    const x = s.arrivedAt - s.publishedAt;
    if (x < -SKEW_MS) {
      skewed++;
      continue;
    }
    d.push(Math.max(0, x));
  }
  d.sort((a, b) => a - b);
  return {
    n: d.length,
    medianMs: d.length ? quantile(d, 0.5) : null,
    p90Ms: d.length ? quantile(d, 0.9) : null,
    skewed,
  };
}
