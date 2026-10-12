import { z } from 'zod';

/** Modo Treino (SPEC §13): dinheiro fictício, preços reais. */

export const paperAccountInputSchema = z.object({
  name: z.string().trim().min(1).max(60).default('Treino'),
  /** Saldo inicial em R$ (editável pelo usuário). */
  initialBalance: z.number().min(100).max(1_000_000_000).default(10_000),
});
export type PaperAccountInput = z.infer<typeof paperAccountInputSchema>;

const costSchema = z.object({
  commissionPerOrder: z.number().min(0).max(10_000),
  feePct: z.number().min(0).max(0.05),
  slippageTicks: z.number().int().min(0).max(100),
  spreadPct: z.number().min(0).max(0.05),
});

export const paperAccountUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  /** Custos por mercado que substituem os padrões (null = voltar ao padrão). */
  costs: z
    .record(z.enum(['crypto', 'us', 'b3', 'forex']), costSchema)
    .nullable()
    .optional(),
  /** Cotação manual do dólar em R$ (usada se a cotação ao vivo faltar). */
  fxManual: z.number().positive().max(100).nullable().optional(),
});
export type PaperAccountUpdate = z.infer<typeof paperAccountUpdateSchema>;

export const paperOrderInputSchema = z
  .object({
    accountId: z.string().min(8).max(64),
    symbolId: z.string().min(3).max(64),
    side: z.enum(['buy', 'sell']),
    type: z.enum(['market', 'limit', 'stop']),
    qty: z.number().positive().finite(),
    price: z.number().positive().finite().nullable().default(null),
    stopLoss: z.number().positive().finite().nullable().default(null),
    takeProfit: z.number().positive().finite().nullable().default(null),
    note: z.string().max(500).default(''),
  })
  .refine((o) => o.type === 'market' || o.price !== null, {
    message: 'informe o preço da ordem limitada/stop',
    path: ['price'],
  });
export type PaperOrderInput = z.infer<typeof paperOrderInputSchema>;

export const paperPositionUpdateSchema = z.object({
  stop: z.number().positive().finite().nullable().optional(),
  target: z.number().positive().finite().nullable().optional(),
  /** Confirmação explícita para afastar o stop (fica registrado no diário). */
  confirmBackward: z.boolean().default(false),
});
export type PaperPositionUpdate = z.infer<typeof paperPositionUpdateSchema>;

export interface PaperAccount {
  id: string;
  name: string;
  initialBalance: number;
  cash: number;
  createdAt: number;
  resetAt: number | null;
  /** Quantas vezes a conta foi reiniciada (o histórico continua). */
  generation: number;
  costs: Record<string, z.infer<typeof costSchema>>;
  fxManual: number | null;
}

export interface PaperPosition {
  id: string;
  accountId: string;
  symbolId: string;
  qty: number;
  avgPrice: number;
  currency: string;
  stop: number | null;
  target: number | null;
  initialStop: number | null;
  openedAt: number;
  closedAt: number | null;
  status: 'open' | 'closed';
  /** Resultado realizado em R$ (já sem taxas). */
  realizedBrl: number;
  feesBrl: number;
  /** Resultado em R (null se entrou sem stop). */
  r: number | null;
  /** Último preço conhecido e resultado aberto (só posições abertas). */
  lastPrice: number | null;
  unrealizedBrl: number | null;
  /** Cotação do dólar usada na entrada (1 para ativos em R$). */
  entryFx: number;
  delayNote: string | null;
  generation: number;
}

export interface PaperOrder {
  id: string;
  accountId: string;
  symbolId: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop';
  qty: number;
  price: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  reason: string | null;
  createdAt: number;
  filledAt: number | null;
  fillPrice: number | null;
  note: string;
}

export const PAPER_EVENT_LABEL = {
  'ordem-criada': 'Ordem criada',
  entrada: 'Entrada executada',
  saida: 'Saída executada',
  'stop-movido': 'Stop movido a favor',
  'stop-movido-para-tras': 'Stop movido PARA TRÁS',
  'alvo-movido': 'Alvo alterado',
  cancelada: 'Ordem cancelada',
  rejeitada: 'Ordem recusada',
  reinicio: 'Conta reiniciada',
} as const;
export type PaperEventKind = keyof typeof PAPER_EVENT_LABEL;

export interface PaperEvent {
  id: string;
  time: number;
  kind: PaperEventKind;
  symbolId: string | null;
  positionId: string | null;
  orderId: string | null;
  price: number | null;
  qty: number | null;
  pnlBrl: number | null;
  feesBrl: number | null;
  fx: number | null;
  detail: string;
}

export interface PaperStats {
  trades: number;
  wins: number;
  winRate: number | null;
  avgR: number | null;
  /** Expectativa por trade em R$. */
  expectancyBrl: number | null;
  totalBrl: number;
  feesBrl: number;
  /** Maior queda do patrimônio (trades fechados), em R$ e % do pico. */
  maxDrawdownBrl: number;
  maxDrawdownPct: number;
  /** Trades sem stop na entrada e com stop movido para trás (disciplina). */
  withoutStop: number;
  stopMovedBack: number;
}
