/**
 * Lista mestre da Biblioteca: toda página tem um slug fixo daqui, para que os botões "?" do app
 * nunca apontem para o vazio (o teste library.test.ts garante isso).
 */
export const LIBRARY_GROUPS = [
  {
    title: 'Comece por aqui',
    slugs: ['antes-de-arriscar-dinheiro', 'contradicoes-entre-as-fontes'],
  },
  {
    title: 'Setups',
    slugs: [
      'setup-9-1',
      'setup-9-2',
      'setup-9-3',
      'recuo-a-media',
      'rompimento-consolidacao',
      'elastico',
      'reflexividade',
      'primitivas-price-action',
      'painel-contexto',
    ],
  },
  {
    title: 'Indicadores',
    slugs: [
      'medias-moveis',
      'bandas-de-bollinger',
      'adx',
      'atr-e-stop-atr',
      'macd',
      'ifr',
      'estocastico',
      'vwap',
      'heikin-ashi',
    ],
  },
  {
    title: 'Leitura do mercado',
    slugs: [
      'teoria-de-dow',
      'candles',
      'suporte-e-resistencia',
      'volume',
      'padroes-graficos',
      'visao-fractal',
    ],
  },
  {
    title: 'Risco, números e cabeça',
    slugs: [
      'gestao-de-risco',
      'r-multiplo',
      'payoff',
      'expectativa',
      'drawdown',
      'slippage-e-custos',
      'psicologia',
    ],
  },
] as const;

export type LibrarySlug = (typeof LIBRARY_GROUPS)[number]['slugs'][number];

export const LIBRARY_SLUGS: readonly LibrarySlug[] = LIBRARY_GROUPS.flatMap((g) => g.slugs);

export const CATEGORIES = ['setup', 'indicador', 'conceito', 'aviso'] as const;

export const libraryPath = (slug: LibrarySlug, anchor?: string) =>
  `/biblioteca/${slug}${anchor ? `#${anchor}` : ''}`;
