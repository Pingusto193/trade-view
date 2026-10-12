import { z } from 'zod';

/** Experimentos prontos "Verificar o youtuber" (SPEC §12.4). */
export const EXPERIMENT_IDS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'] as const;
export type ExperimentId = (typeof EXPERIMENT_IDS)[number];
export const experimentIdSchema = z.enum(EXPERIMENT_IDS);

export type UniverseId = 'b3' | 'cripto' | 'eua' | 'sim';

/**
 * Conjuntos sugeridos (editáveis na tela). A lista da B3 é de ações conhecidas e líquidas escolhidas
 * por nós: composição e liquidez NÃO verificadas hoje (🟡) — e testar a lista ATUAL é viés de
 * sobrevivência (as que quebraram ou saíram da bolsa não aparecem).
 */
export const UNIVERSES: Readonly<
  Record<UniverseId, { label: string; symbols: readonly string[] }>
> = {
  b3: {
    label: 'Ações da B3 (20)',
    symbols: [
      'PETR4',
      'VALE3',
      'ITUB4',
      'BBDC4',
      'BBAS3',
      'ABEV3',
      'B3SA3',
      'WEGE3',
      'RENT3',
      'SUZB3',
      'PRIO3',
      'ITSA4',
      'GGBR4',
      'RADL3',
      'EQTL3',
      'LREN3',
      'VIVT3',
      'CSAN3',
      'BBSE3',
      'CMIG4',
    ].map((t) => `brapi:${t}`),
  },
  cripto: {
    label: 'Cripto (5)',
    symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'].map((t) => `binance:${t}`),
  },
  eua: {
    label: 'EUA (5)',
    symbols: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA'].map((t) => `alpaca:${t}`),
  },
  sim: {
    label: 'Simulados (desenvolvimento)',
    symbols: ['sim:SIMACAO', 'sim:SIMBTC', 'sim:SIMFX'],
  },
};

export interface ExperimentInfo {
  id: ExperimentId;
  title: string;
  /** O que o vídeo afirma (afirmação, não fato). */
  claim: string;
  hypothesis: string;
  method: string;
  limitations: string[];
  universe: UniverseId;
}

const COMMON_LIMITS = [
  'Lista de ativos escolhida hoje: viés de sobrevivência (os que quebraram ou saíram da bolsa não entram).',
  'Histórico da B3 longo vem dos arquivos COTAHIST, sem ajuste por proventos e desdobramentos: quedas falsas podem gerar sinais.',
  'Custos padrão do mercado (taxas, spread e derrapagem) e só compras (vender a descoberto teria aluguel/margem).',
];

export const EXPERIMENTS: Readonly<Record<ExperimentId, ExperimentInfo>> = {
  e1: {
    id: 'e1',
    title: 'E1 — 9.1 com e sem o filtro "MMA50 subindo"',
    claim:
      'Sem o filtro o 9.1 "não deu dinheiro"; com o filtro "mudou completamente" (sem números).',
    hypothesis:
      'Se o filtro ajuda de verdade, a expectativa por trade com filtro é maior e a diferença passa do barulho do acaso.',
    method:
      'Mesmo detector do app no diário, ~10 anos, em cada ativo; só o filtro da MMA50 muda entre as duas variantes (o "não operar em lateral" fica ligado nas duas). Resultados em R somados de todos os ativos; teste t de Welch na diferença.',
    limitations: COMMON_LIMITS,
    universe: 'b3',
  },
  e2: {
    id: 'e2',
    title: 'E2 — Fechamentos fora da Bollinger 20/3 ("1 em 1000")',
    claim:
      'Fechar fora da banda de 3 desvios seria raríssimo ("1 em 1000"), então o preço tende a voltar.',
    hypothesis:
      'Mercado tem caudas gordas: o preço fecha fora da banda bem mais vezes que a curva normal prevê.',
    method:
      'Conta os fechamentos fora da banda (20 candles, 3 desvios) no diário e compara com a curva normal (0,135% por lado) e com um passeio aleatório normal de mesma volatilidade medido com a mesma régua. Mede também quantas vezes o preço tocou a média central em até 10 candles.',
    limitations: [
      'A curva normal é uma régua aproximada: a banda olha só 20 candles, por isso o passeio aleatório é a comparação justa.',
      'Voltar à média não diz se dava para lucrar: falta stop, custo e o que aconteceu antes de voltar.',
      COMMON_LIMITS[0]!,
    ],
    universe: 'b3',
  },
  e3: {
    id: 'e3',
    title: 'E3 — 9.2 e 9.3 no semanal e mensal × diário e 60 min',
    claim: 'Os setups funcionariam em qualquer tempo gráfico.',
    hypothesis:
      'A expectativa muda com a escala; escalas pequenas sofrem mais com custos (stop curto).',
    method:
      'Mesmo detector em cada escala (mensal, semanal, diário e 60 min), com os custos padrão. Compara semanal e mensal contra o diário, e o diário contra 60 min, com o teste t de Welch.',
    limitations: [
      'Mensal e semanal têm poucos candles em 10–20 anos: amostra pequena (inconclusiva) é o resultado mais provável.',
      'Histórico de 60 min depende da fonte (no plano gratuito, a B3 tem pouco histórico intradiário).',
      ...COMMON_LIMITS,
    ],
    universe: 'b3',
  },
  e4: {
    id: 'e4',
    title: 'E4 — Recuo à média com e sem os filtros de "recuo saudável"',
    claim: 'Recuo com volume secando e candles menores é melhor.',
    hypothesis: 'Exigir recuo saudável aumenta a expectativa por trade (mesmo com menos trades).',
    method:
      'Recuo à média no diário com requireHealthy desligado × ligado (pontuação ≥ 2 e sem alertas). Teste t de Welch na diferença.',
    limitations: COMMON_LIMITS,
    universe: 'b3',
  },
  e5: {
    id: 'e5',
    title: 'E5 — Rompimento de consolidação: volume e reteste',
    claim: 'Rompimento só vale com volume forte; reteste seria entrada melhor.',
    hypothesis:
      'Exigir volume ≥ 1,5× a média melhora o resultado; entrar no reteste muda a expectativa.',
    method:
      'Rompimento de consolidação no diário em três variantes: com exigência de volume (padrão), sem exigência, e com entrada no reteste. Compara cada uma com a padrão.',
    limitations: [
      'Sem dado de volume confiável (ex.: forex), a exigência de volume cancela os sinais.',
      ...COMMON_LIMITS,
    ],
    universe: 'b3',
  },
  e6: {
    id: 'e6',
    title: 'E6 — "40% de acerto com 1:2 dá lucro" depois de custos e IR',
    claim: '40% de acerto com ganho de 2 para cada 1 de risco já dá lucro.',
    hypothesis:
      'A conta (+0,2 R por trade) ignora custos: com stop curto (day trade) o custo come a vantagem.',
    method:
      'Para cada ativo e escala (5, 15 e 60 min = day trade; diário = swing), mede o stop típico (1 × ATR14) e o custo de ida e volta, transforma o custo em R e recalcula a expectativa e a taxa de acerto mínima. IR simulado só na B3 (20% day trade, 15% swing, sem isenção nem compensação).',
    limitations: [
      'Stop de 1 ATR é uma escolha nossa (setups reais usam stops diferentes).',
      'Supõe que os 40% de acerto continuam iguais em qualquer escala — é a premissa do vídeo, não um fato.',
      'IR de cripto e EUA não simulado.',
    ],
    universe: 'b3',
  },
  e7: {
    id: 'e7',
    title: 'E7 — Reflexividade: comprar a −50% × esperar o pivô',
    claim: 'Proibido comprar durante a queda: esperar o pivô de alta no semanal.',
    hypothesis:
      'Esperar o pivô evita parte das quedas que continuam (menor pior queda por compra).',
    method:
      'No semanal (~20 anos): (a) compra ingênua no 1º fechamento a −50% do topo de 52 semanas, segurando 52 semanas sem stop; (b) o detector de Reflexividade (pivô de alta, stop no fundo, alvo 3R). Compara retorno por compra, acerto e pior queda.',
    limitations: [
      'Sem as empresas que quebraram ou saíram da bolsa, o resultado é OTIMISTA para as duas variantes (SPEC E7).',
      'Fundamentos (LPA, receita) não verificados: o detector roda sem esse filtro.',
      'Compras raras: poucos casos por ativo, amostra quase sempre pequena.',
      COMMON_LIMITS[1]!,
    ],
    universe: 'b3',
  },
};

export const experimentRunInputSchema = z.object({
  symbols: z.array(z.string().min(3).max(64)).min(1).max(30),
});
export type ExperimentRunInput = z.infer<typeof experimentRunInputSchema>;

export interface PooledStats {
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
  profitFactorR: number | null;
  sample: 'inconclusivo' | 'evidência fraca' | 'amostra razoável';
}

export interface SymbolRow {
  symbolId: string;
  trades: number;
  expectancyR: number | null;
  /** Período coberto pelos dados (ou o erro da fonte). */
  from?: number;
  to?: number;
  bars?: number;
  error?: string;
}

export interface VariantResult {
  key: string;
  label: string;
  tf: string;
  pooled: PooledStats;
  /** Últimos 30% de cada ativo (fora da amostra cronológica). */
  test: PooledStats;
  perSymbol: SymbolRow[];
  /** Retorno médio por trade (fração do preço de entrada, depois dos custos). */
  avgReturn: number | null;
}

export interface Comparison {
  a: string;
  b: string;
  label: string;
  diffR: number | null;
  t: number | null;
  meaningful: boolean;
}

export interface TailsRow {
  symbolId: string;
  error?: string;
  closes?: number;
  above?: number;
  below?: number;
  rateAbove?: number;
  rateBelow?: number;
  normalPerSide?: number;
  randomWalkPerSide?: number;
  backToMean?: { events: number; within: number; rate: number | null };
  horizon?: number;
  from?: number;
  to?: number;
}

export interface CostsRow {
  symbolId: string;
  tf: string;
  error?: string;
  modality?: 'day trade' | 'swing';
  taxRate?: number | null;
  stopPct?: number;
  roundTripPct?: number;
  costR?: number;
  grossR?: number;
  netR?: number;
  afterTaxR?: number;
  breakEvenWinRate?: number;
}

export interface NaiveStats {
  buys: number;
  avgReturn: number | null;
  medianReturn: number | null;
  winRate: number | null;
  avgWorst: number | null;
}

export type ExperimentResult =
  | { kind: 'variants'; variants: VariantResult[]; comparisons: Comparison[] }
  | { kind: 'tails'; rows: TailsRow[] }
  | { kind: 'costs'; rows: CostsRow[] }
  | {
      kind: 'reflexivity';
      naive: NaiveStats;
      naivePerSymbol: (NaiveStats & { symbolId: string; error?: string })[];
      setup: VariantResult;
      /** Pior queda média até a saída nas compras da Reflexividade. */
      setupAvgWorst: number | null;
    };

export interface ExperimentRun {
  id: string;
  experimentId: ExperimentId;
  createdAt: number;
  finishedAt: number | null;
  status: 'running' | 'done' | 'error';
  progress: { done: number; total: number };
  symbols: string[];
  result: ExperimentResult | null;
  dataNotes: string[];
  /** Resumo em uma linha, em PT-BR (gerado pelos números, sem adjetivo). */
  summary: string | null;
  error: string | null;
}
