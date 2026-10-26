import type { AssetTag, NewsKind } from '@radar/shared';
import type { RawNews } from './feed';

/**
 * Definição de uma fonte de notícias (ADR-0032). Toda fonte real precisa estar registrada em
 * docs/DATA_SOURCES.md (termos, limites, atraso) antes de entrar em NEWS_SOURCES.
 */
export interface NewsSourceDef {
  id: string;
  label: string;
  kind: NewsKind;
  lang: 'pt' | 'en';
  url: string;
  /** Intervalo de consulta (respeitando o que a fonte pede). */
  intervalMs: number;
  /** Como ler: feed RSS/Atom genérico, 8-K da SEC ou o gerador simulado (só desenvolvimento). */
  reader: 'feed' | 'sec-8k' | 'sim';
  /** Resumo dos termos de uso (o detalhe e o link ficam em DATA_SOURCES). */
  terms: string;
  /**
   * Os termos permitem resumo por IA (só de título + trecho do feed)? Fontes que não permitem aparecem
   * só com título e link (DATA_SOURCES §19).
   */
  aiSummary: boolean;
  /**
   * Configuração exigida (sem ela a fonte fica desligada com o motivo). SEC_USER_AGENT = User-Agent com
   * nome e e-mail de contato: a SEC exige e o BLS recusa robôs sem ele (HTTP 403 em 26/10/2026).
   */
  requires?: 'SEC_USER_AGENT';
  /** Etiquetas aplicadas a toda notícia da fonte (ex.: Fed → juros-us). */
  baseTags?: AssetTag[];
}

/** Fonte de DADOS SIMULADOS (só com RADAR_SIMULATED=1): manchetes falsas com "[SIMULADO]" no título. */
export const SIM_NEWS_SOURCE: NewsSourceDef = {
  id: 'sim-news',
  label: 'Notícias SIMULADAS (desenvolvimento)',
  kind: 'noticia',
  lang: 'pt',
  url: 'sim://news',
  intervalMs: 60_000,
  reader: 'sim',
  terms: 'Gerado localmente; não é notícia real.',
  aiSummary: false,
};

const SIM_HEADLINES = [
  'SIMBTC dispara após anúncio fictício de ETF',
  'Dólar sobe com juros nos EUA em alta (fictício)',
  'SIMBTC recua com realização de lucros fictícia',
  'SIMACAO divulga resultado trimestral fictício',
  'Copom fictício mantém Selic; SIMBTC e Ibovespa reagem',
];

/**
 * Gera 1 manchete simulada por minuto (as dos últimos 5 minutos a cada leitura; determinística pelo
 * minuto), com "[SIMULADO]" no título, para testar o feed e os marcadores sem internet. Nunca é usada em
 * produção (o servidor recusa dados simulados).
 */
export function simulatedNews(now: number): RawNews[] {
  const minute = Math.floor(now / 60_000);
  const out: RawNews[] = [];
  for (let k = 0; k < 5; k++) {
    const m = minute - k;
    const title = `[SIMULADO] ${SIM_HEADLINES[((m % SIM_HEADLINES.length) + SIM_HEADLINES.length) % SIM_HEADLINES.length]}`;
    out.push({
      guid: `sim-${m}`,
      url: `https://radar.invalid/simulado/${m}`,
      title,
      snippet: 'Notícia gerada pelo simulador do Radar para testes. Não aconteceu.',
      publishedAt: m * 60_000,
      categories: ['simulado'],
      rawSummary: null,
    });
  }
  return out;
}

const MIN = 60_000;

/**
 * Fontes reais ligadas (DATA_SOURCES §19: termos favoráveis; formato lido pelo workflow "Dados reais").
 * Fontes evitadas por termos ou bloqueio a robôs ficam de fora (lista no §19; a Nasdaq saiu em
 * 26/10/2026: não respondeu em 20 s).
 */
export const NEWS_SOURCES: readonly NewsSourceDef[] = [
  {
    id: 'sec-8k',
    label: 'SEC EDGAR (8-K)',
    kind: 'sec-8k',
    lang: 'en',
    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&owner=include&start=0&count=40&output=atom',
    intervalMs: 2 * MIN,
    reader: 'sec-8k',
    requires: 'SEC_USER_AGENT',
    terms: 'Informação pública da SEC; pode ser copiada sem permissão.',
    aiSummary: true,
  },
  {
    id: 'bcb-notas',
    label: 'Banco Central (notas à imprensa)',
    kind: 'oficial',
    lang: 'pt',
    url: 'https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/notasImprensa',
    intervalMs: 5 * MIN,
    reader: 'feed',
    terms: 'Dados abertos do BCB (ODbL).',
    aiSummary: true,
    baseTags: [{ type: 'macro', value: 'juros-br' }],
  },
  {
    id: 'fed-monetary',
    label: 'Federal Reserve (política monetária)',
    kind: 'oficial',
    lang: 'en',
    url: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
    intervalMs: 10 * MIN,
    reader: 'feed',
    terms: 'Domínio público; citar o Board.',
    aiSummary: true,
    baseTags: [{ type: 'macro', value: 'juros-us' }],
  },
  {
    id: 'bls-empsit',
    label: 'BLS (emprego / payroll)',
    kind: 'oficial',
    lang: 'en',
    url: 'https://www.bls.gov/feed/empsit.rss',
    intervalMs: 15 * MIN,
    reader: 'feed',
    requires: 'SEC_USER_AGENT',
    terms: 'Domínio público, com crédito ao BLS.',
    aiSummary: true,
    baseTags: [{ type: 'macro', value: 'emprego-us' }],
  },
  {
    id: 'bls-cpi',
    label: 'BLS (inflação / CPI)',
    kind: 'oficial',
    lang: 'en',
    url: 'https://www.bls.gov/feed/cpi.rss',
    intervalMs: 15 * MIN,
    reader: 'feed',
    requires: 'SEC_USER_AGENT',
    terms: 'Domínio público, com crédito ao BLS.',
    aiSummary: true,
    baseTags: [{ type: 'macro', value: 'inflacao-us' }],
  },
  {
    id: 'agencia-brasil-economia',
    label: 'Agência Brasil (Economia)',
    kind: 'noticia',
    lang: 'pt',
    url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml',
    intervalMs: 5 * MIN,
    reader: 'feed',
    terms:
      'Conteúdo próprio reproduzível citando "Agência Brasil"; o de agências internacionais, não.',
    aiSummary: true,
  },
];
