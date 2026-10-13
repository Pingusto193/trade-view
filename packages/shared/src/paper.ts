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

// o schema do plano é declarado mais abaixo no arquivo
const tradePlanSchemaLazy = () => z.lazy(() => tradePlanSchema);

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
    /** Plano de trade (opcional no treino; a falta dele conta na disciplina). */
    plan: tradePlanSchemaLazy().nullable().default(null),
  })
  .refine((o) => o.type === 'market' || o.price !== null, {
    message: 'informe o preço da ordem limitada/stop',
    path: ['price'],
  });
export type PaperOrderInput = z.infer<typeof paperOrderInputSchema>;
/** O que o navegador envia (campos com padrão são opcionais). */
export type PaperOrderDraft = z.input<typeof paperOrderInputSchema>;

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
  /** Plano de entrada (sem o print), se houve. `missing` = o que faltava para liberar, na entrada. */
  plan:
    | (Omit<TradePlan, 'screenshot'> & {
        released: boolean;
        hasScreenshot: boolean;
        missing?: string[];
      })
    | null;
  /**
   * Só no diário: risco planejado em % do patrimônio (trades fechados) na entrada — null quando não
   * dá para medir (sem stop, ou de antes de um reinício da conta).
   */
  riskPct?: number | null;
  /** Só no diário: o stop foi afastado em algum momento. */
  stopMovedBack?: boolean;
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
  /** Trades que entraram com o plano liberado. */
  withPlan: number;
  /** % de trades disciplinados: plano liberado, com stop e sem stop movido para trás. */
  disciplinePct: number | null;
}

/**
 * Plano de trade (SPEC §11), preenchido ANTES de entrar. Só fica "Liberado" com tudo completo.
 * No treino ele não bloqueia a ordem, mas a falta dele conta na estatística de disciplina.
 */
export const PSYCH_CHECKS = {
  ego: 'Não estou querendo provar que estou certo',
  revanche: 'Não é para recuperar uma perda (revanche)',
  lucro: 'Sei o que faço se o lucro começar a voltar',
  demais: 'Não estou operando demais hoje',
  plano: 'Vou seguir este plano até o fim',
} as const;
export type PsychCheck = keyof typeof PSYCH_CHECKS;

export const EXIT_CRITERIA = {
  alvo: 'Alvo fixo (stop e alvo definidos)',
  'stop-atr': 'Conduzir com o Stop ATR',
  mme9: 'Conduzir: sair quando a MME9 virar para baixo e a mínima for perdida',
} as const;

export const tradePlanSchema = z.object({
  // vazio = setup não escolhido: o plano fica incompleto (planMissing), mas a ordem vale
  setup: z.string().max(40),
  tfContext: z.string().max(4),
  tfSetup: z.string().max(4),
  tfTrigger: z.string().max(4),
  /** As três escalas estão a favor? (resposta do usuário, com o contexto automático ao lado). */
  aligned: z.boolean(),
  exitCriterion: z.enum(['alvo', 'stop-atr', 'mme9']),
  reason: z.string().max(1000),
  checks: z.object({
    ego: z.boolean().optional(),
    revanche: z.boolean().optional(),
    lucro: z.boolean().optional(),
    demais: z.boolean().optional(),
    plano: z.boolean().optional(),
  }),
  /** Avisos automáticos mostrados no momento (registro do que você sabia ao entrar). */
  warnings: z.array(z.string().max(300)).max(20),
  /** Print do gráfico (JPEG em data URL, reduzido). */
  screenshot: z
    .string()
    .max(400_000)
    .regex(/^data:image\/(jpeg|png);base64,/)
    .nullable(),
});
export type TradePlan = z.infer<typeof tradePlanSchema>;

/**
 * Aviso automático da boleta gravado no plano quando a compra vai contra a escala maior (aviso
 * vermelho, SPEC §9/§11). O feedback do trade lê este registro.
 */
export const AGAINST_HIGHER_WARNING = '⚠ Compra contra a escala maior (aviso vermelho).';

/** O plano registrou, na entrada, que a compra ia contra a escala maior? */
export function planAgainstHigher(warnings: readonly string[]): boolean {
  return warnings.some((w) => /contra a escala maior/i.test(w));
}

/** O que falta para o plano ficar "Liberado" (lista vazia = liberado). */
export function planMissing(
  p: Partial<TradePlan>,
  order: { stopLoss: number | null; takeProfit: number | null; qty: number | null },
): string[] {
  const miss: string[] = [];
  if (!p.setup) miss.push('setup');
  if (!p.tfContext || !p.tfSetup || !p.tfTrigger) miss.push('escalas');
  if (order.stopLoss === null) miss.push('stop técnico');
  if (p.exitCriterion === 'alvo' && order.takeProfit === null) miss.push('alvo');
  if (!order.qty) miss.push('tamanho da posição');
  if (!p.reason || p.reason.trim().length < 15) miss.push('motivo técnico (mín. 15 letras)');
  if (!p.screenshot) miss.push('print do gráfico');
  const checks: Partial<Record<PsychCheck, boolean>> = p.checks ?? {};
  if (Object.keys(PSYCH_CHECKS).some((k) => !checks[k as PsychCheck])) miss.push('checklist');
  return miss;
}
