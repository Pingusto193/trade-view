import { z } from 'zod';

/**
 * Notícias (SPEC §23.1, ADR-0032). Guardamos só título, link, datas e um trecho curto vindo do próprio
 * feed — nunca o texto integral da matéria.
 */
export const NEWS_KINDS = ['noticia', 'fato-relevante', 'sec-8k', 'oficial'] as const;
export type NewsKind = (typeof NEWS_KINDS)[number];

export const NEWS_KIND_LABEL: Readonly<Record<NewsKind, string>> = {
  noticia: 'Notícia',
  'fato-relevante': 'Fato relevante',
  'sec-8k': 'SEC 8-K',
  oficial: 'Comunicado oficial',
};

/**
 * Etiqueta de ativo. `ticker` = código (PETR4, AAPL); `moeda` = USD, EUR, BRL; `indice` = IBOV, SPX;
 * `setor` = petroleo, bancos…; `macro` = juros-br, inflacao-br, juros-us, emprego-us…; `cripto` = BTC, ETH.
 */
export const ASSET_TAG_TYPES = ['ticker', 'moeda', 'indice', 'setor', 'macro', 'cripto'] as const;
export type AssetTagType = (typeof ASSET_TAG_TYPES)[number];
export interface AssetTag {
  type: AssetTagType;
  value: string;
}
export const assetTagKey = (t: AssetTag) => `${t.type}:${t.value}`;

export interface NewsItem {
  id: string;
  sourceId: string;
  sourceLabel: string;
  kind: NewsKind;
  lang: 'pt' | 'en';
  url: string;
  title: string;
  /** Trecho curto do próprio feed (≤ 300 caracteres), sem HTML. */
  snippet: string | null;
  /** Publicação informada pela fonte (UTC ms); null quando a fonte não informa (nunca inventamos). */
  publishedAt: number | null;
  /** Quando o Radar viu a notícia pela primeira vez (UTC ms). */
  arrivedAt: number;
  /** Já estava no feed quando o Radar começou a ler a fonte: fora da medição de atraso. */
  backlog: boolean;
  tags: AssetTag[];
  /** Mesma notícia vista antes em outra fonte (id da primeira). */
  duplicateOf: string | null;
  /** Os termos da fonte permitem resumo por IA (DATA_SOURCES §19)? */
  aiAllowed: boolean;
  /** Resumo por IA (só fontes que permitem; null = não resumida). */
  ai: NewsAi | null;
}

export const NEWS_SENTIMENTS = ['positivo', 'negativo', 'neutro', 'misto'] as const;
export type NewsSentiment = (typeof NEWS_SENTIMENTS)[number];

/** Resumo de 2–3 linhas feito pela IA só a partir do título e do trecho do feed (SPEC §23.1). */
export interface NewsAi {
  summary: string | null;
  /** 1 (irrelevante para preços) a 5 (pode mexer forte no mesmo dia). */
  relevance: number | null;
  sentiment: NewsSentiment | null;
  /** Ativos, moedas ou índices que a IA apontou como afetados. */
  assets: string[];
  model: string | null;
  /** Por que não há resumo (recusa, erro da API). */
  error: string | null;
  createdAt: number;
}

/** Resumo por IA das notícias: usa a chave e os preços do Assistente, com limite mensal próprio. */
export const newsAiSettingsInputSchema = z.object({
  enabled: z.boolean(),
  /** Vazio = o mesmo modelo do Assistente. */
  model: z.string().trim().max(80).optional(),
  monthlyLimitUsd: z.number().min(0.1).max(1000),
});
export type NewsAiSettingsInput = z.infer<typeof newsAiSettingsInputSchema>;

export interface NewsAiSettings {
  enabled: boolean;
  model: string | null;
  /** Modelo que será usado (o próprio ou o do Assistente). */
  effectiveModel: string | null;
  monthlyLimitUsd: number;
  month: string;
  spentUsd: number;
  requests: number;
  /** Chave e preços vêm do Assistente (Conta › Assistente). */
  keyConfigured: boolean;
  pricesConfigured: boolean;
  /** Na fila esperando resumo. */
  pending: number;
}

export interface NewsSourceStatus {
  id: string;
  label: string;
  kind: NewsKind;
  lang: 'pt' | 'en';
  enabled: boolean;
  /** Motivo de estar desligada (ex.: falta SEC_USER_AGENT). */
  disabledReason: string | null;
  intervalMs: number;
  lastPollAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  items24h: number;
  /** Atraso (chegada − publicação) das notícias novas, em ms: mediana e percentil 90; n = amostra. */
  delay: { n: number; medianMs: number | null; p90Ms: number | null };
  terms: string;
}

export const newsQuerySchema = z.object({
  /** Ids de ativo do Radar (binance:BTCUSDT, mt5:WDOZ26…) cujas notícias interessam. */
  symbols: z.array(z.string().max(60)).max(50).optional(),
  kinds: z.array(z.enum(NEWS_KINDS)).optional(),
  /** Só depois deste instante (UTC ms). */
  since: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  /** Inclui as repetidas (mesma notícia em outra fonte). */
  duplicates: z.boolean().default(false),
});
export type NewsQuery = z.infer<typeof newsQuerySchema>;
