import { z } from 'zod';
import { tradePlanSchema, type PaperEventKind, type TradePlan } from './paper';

/**
 * Diário de trades REAIS (SPEC §13): o Radar não envia ordens; o usuário registra o que executou na
 * corretora. Regras de quantidade por mercado (SPEC §11) — fatos em docs/DATA_SOURCES.md §5 e §8.
 * Lote mínimo de cripto e forex varia por corretora/exchange: o usuário ajusta.
 */
export const REAL_MARKETS = {
  'b3-acao': {
    label: 'Ações da B3',
    currency: 'BRL',
    lotSize: 100,
    minQty: 1,
    qtyStep: 1,
    pointValue: 1,
    fractional: true,
    taxClass: 'acao',
    qtyLabel: 'ações',
    note: 'Lote padrão de 100; o que passar de lotes inteiros vai para o fracionário.',
  },
  'b3-win': {
    label: 'Mini-índice (WIN)',
    currency: 'BRL',
    lotSize: 1,
    minQty: 1,
    qtyStep: 1,
    pointValue: 0.2,
    fractional: false,
    taxClass: 'outro',
    qtyLabel: 'contratos',
    note: 'R$ 0,20 por ponto por contrato; o preço anda de 5 em 5 pontos (R$ 1,00).',
  },
  'b3-wdo': {
    label: 'Mini-dólar (WDO)',
    currency: 'BRL',
    lotSize: 1,
    minQty: 1,
    qtyStep: 1,
    pointValue: 10,
    fractional: false,
    taxClass: 'outro',
    qtyLabel: 'contratos',
    note: 'R$ 10,00 por ponto por contrato; o preço anda de 0,5 em 0,5 ponto (R$ 5,00).',
  },
  eua: {
    label: 'Ações dos EUA',
    currency: 'USD',
    lotSize: 1,
    minQty: 1,
    qtyStep: 1,
    pointValue: 1,
    fractional: false,
    taxClass: null,
    qtyLabel: 'ações',
    note: 'Algumas corretoras aceitam fração de ação; aqui a conta usa ações inteiras.',
  },
  cripto: {
    label: 'Cripto',
    currency: 'USD',
    lotSize: 0.00001,
    minQty: 0.00001,
    qtyStep: 0.00001,
    pointValue: 1,
    fractional: false,
    taxClass: null,
    qtyLabel: 'unidades',
    note: 'O passo mínimo muda por moeda e corretora: confira na sua e ajuste.',
  },
  forex: {
    label: 'Forex',
    currency: 'USD',
    lotSize: 0.01,
    minQty: 0.01,
    qtyStep: 0.01,
    pointValue: 100_000,
    fractional: false,
    taxClass: null,
    qtyLabel: 'lotes',
    note: '1 lote = 100.000 da moeda base; resultado na moeda de cotação do par. Lote mínimo varia por corretora.',
  },
} as const satisfies Record<
  string,
  {
    label: string;
    currency: string;
    lotSize: number;
    minQty: number;
    qtyStep: number;
    pointValue: number;
    fractional: boolean;
    taxClass: 'acao' | 'outro' | null;
    qtyLabel: string;
    note: string;
  }
>;
export type RealMarket = keyof typeof REAL_MARKETS;
export const REAL_MARKET_IDS = Object.keys(REAL_MARKETS) as [RealMarket, ...RealMarket[]];

const price = z.number().positive().max(1e9);

export const realFillInputSchema = z.object({
  time: z
    .number()
    .int()
    .min(Date.UTC(2000, 0, 1)),
  kind: z.enum(['entrada', 'saida']),
  qty: z.number().positive().max(1e9),
  price,
  feesBrl: z.number().min(0).max(1e7).default(0),
  /** Câmbio R$ por unidade da moeda do ativo (1 para ativos em reais). */
  fx: z.number().positive().max(1000).default(1),
});
export type RealFillInput = z.infer<typeof realFillInputSchema>;

export const realTradeInputSchema = z.object({
  /** Texto livre (PETR4, WINZ26, EURUSD): nem todo ativo existe nas fontes do Radar. */
  symbol: z.string().trim().min(1).max(30),
  /** Ativo escolhido na busca (para abrir o gráfico), se houver. */
  symbolId: z.string().max(64).nullable().default(null),
  market: z.enum(REAL_MARKET_IDS),
  side: z.enum(['long', 'short']),
  currency: z.string().trim().min(3).max(5),
  pointValue: z.number().positive().max(1e7),
  initialStop: price.nullable(),
  target: price.nullable(),
  entry: realFillInputSchema.extend({ kind: z.literal('entrada') }),
  note: z.string().max(2000).default(''),
  plan: tradePlanSchema.nullable().default(null),
});
export type RealTradeInput = z.infer<typeof realTradeInputSchema>;

export const realTradeUpdateSchema = z.object({
  stop: price.nullable().optional(),
  target: price.nullable().optional(),
  note: z.string().max(2000).optional(),
  /** Afastar o stop exige confirmação explícita (SPEC §11) e fica registrado. */
  confirmMovedBack: z.boolean().optional(),
});
export type RealTradeUpdate = z.infer<typeof realTradeUpdateSchema>;

export interface RealFill {
  id: string;
  time: number;
  kind: 'entrada' | 'saida';
  qty: number;
  price: number;
  feesBrl: number;
  fx: number;
}

export interface RealEvent {
  id: string;
  time: number;
  kind: PaperEventKind;
  price: number | null;
  detail: string;
}

export interface RealTrade {
  id: string;
  symbol: string;
  symbolId: string | null;
  market: RealMarket;
  side: 'long' | 'short';
  currency: string;
  pointValue: number;
  initialStop: number | null;
  stop: number | null;
  target: number | null;
  note: string;
  plan: (Omit<TradePlan, 'screenshot'> & { released: boolean; missing: string[] }) | null;
  hasScreenshot: boolean;
  createdAt: number;
  status: 'aberto' | 'fechado';
  avgEntry: number | null;
  openQty: number;
  maxQty: number;
  avgExit: number | null;
  realizedBrl: number;
  feesBrl: number;
  initialRiskBrl: number | null;
  r: number | null;
  openedAt: number | null;
  closedAt: number | null;
  stopMovedBack: boolean;
  fills: RealFill[];
  events: RealEvent[];
}
