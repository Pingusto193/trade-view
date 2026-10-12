import { z } from 'zod';
import { timeframeSchema } from './timeframes';

/**
 * Desenhos (SPEC §7). Os pontos usam TEMPO REAL (UTC ms) e preço — não índices de barra —, para que
 * o mesmo desenho apareça certo em qualquer escala ("copiar entre timeframes").
 */
export const pointSchema = z.object({ time: z.number(), price: z.number() });
export type DrawingPoint = z.infer<typeof pointSchema>;

export const DRAWING_KINDS = [
  'hline',
  'vline',
  'trend',
  'ray',
  'zone',
  'channel',
  'fib',
  'ruler',
  'position',
  'text',
] as const;
export type DrawingKind = (typeof DRAWING_KINDS)[number];

export const DRAWING_LABEL: Readonly<Record<DrawingKind, string>> = {
  hline: 'Linha horizontal',
  vline: 'Linha vertical',
  trend: 'Linha de tendência',
  ray: 'Raio',
  zone: 'Zona de preço',
  channel: 'Canal paralelo',
  fib: 'Fibonacci',
  ruler: 'Régua',
  position: 'Posição comprada/vendida',
  text: 'Texto / nota',
};

/** Quantos cliques cada ferramenta precisa para ser criada. */
export const DRAWING_POINTS: Readonly<Record<DrawingKind, number>> = {
  hline: 1,
  vline: 1,
  trend: 2,
  ray: 2,
  zone: 2,
  channel: 3,
  fib: 2,
  ruler: 2,
  position: 2, // entrada e stop; alvo calculado em 2R (editável)
  text: 1,
};

export const DEFAULT_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618];

const style = z.object({
  color: z.string().max(32).default('#38bdf8'),
  lineWidth: z.number().min(1).max(4).default(2),
  dashed: z.boolean().default(false),
});

export const drawingDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hline'), points: z.array(pointSchema).length(1) }),
  z.object({ kind: z.literal('vline'), points: z.array(pointSchema).length(1) }),
  z.object({ kind: z.literal('trend'), points: z.array(pointSchema).length(2) }),
  z.object({ kind: z.literal('ray'), points: z.array(pointSchema).length(2) }),
  z.object({
    kind: z.literal('zone'),
    points: z.array(pointSchema).length(2),
    /** Zonas de suporte/resistência normalmente se estendem para a direita. */
    extendRight: z.boolean().default(true),
  }),
  z.object({ kind: z.literal('channel'), points: z.array(pointSchema).length(3) }),
  z.object({
    kind: z.literal('fib'),
    points: z.array(pointSchema).length(2),
    levels: z.array(z.number()).max(20).default(DEFAULT_FIB_LEVELS),
  }),
  z.object({ kind: z.literal('ruler'), points: z.array(pointSchema).length(2) }),
  z.object({
    kind: z.literal('position'),
    side: z.enum(['long', 'short']),
    /** points[0] = entrada (tempo e preço), points[1] = stop (tempo e preço). */
    points: z.array(pointSchema).length(2),
    target: z.number(),
  }),
  z.object({
    kind: z.literal('text'),
    points: z.array(pointSchema).length(1),
    text: z.string().max(500),
  }),
]);
export type DrawingData = z.infer<typeof drawingDataSchema>;

export const drawingSchema = z.object({
  id: z.string().min(8).max(64),
  symbolId: z.string().min(3).max(60),
  /** null = aparece em todas as escalas. */
  tf: timeframeSchema.nullable(),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  style: style.default({ color: '#38bdf8', lineWidth: 2, dashed: false }),
  data: drawingDataSchema,
  rev: z.number().int().optional(),
  updatedAt: z.number().optional(),
});
export type Drawing = z.infer<typeof drawingSchema>;
