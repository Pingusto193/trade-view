import { z } from 'zod';

/**
 * Trilha de aprendizado (SPEC §13): módulos em sequência, cada um com leitura na Biblioteca, exercícios
 * de leitura e, nos módulos de setup, uma missão de replay. Metas (quantidades) são nossas, arbitrárias
 * (ADR-0026): servem para dar ritmo, não provam habilidade.
 */
export interface TrailModule {
  id: string;
  title: string;
  desc: string;
  /** Páginas da Biblioteca para ler (slugs). */
  read: string[];
  /** Acertar N exercícios por completo, no nível indicado ou acima; `setups` = só desses setups. */
  exercises: { level: 1 | 2 | 3; perfect: number; setups?: string[] } | null;
  /** N trades de replay (com plano liberado), opcionalmente só desses setups. */
  replay: { trades: number; setups?: string[] } | null;
}

export const TRAIL: readonly TrailModule[] = [
  {
    id: 'candles',
    title: 'Ler candles',
    desc: 'Corpo, sombras, candle de força, martelo e o que cada um conta (e o que não conta).',
    read: ['candles', 'primitivas-price-action'],
    exercises: { level: 1, perfect: 5 },
    replay: null,
  },
  {
    id: 'suporte-resistencia',
    title: 'Suporte e resistência como zonas',
    desc: 'Topos e fundos confirmados, rompimento por fechamento e falso rompimento.',
    read: ['suporte-e-resistencia', 'teoria-de-dow'],
    exercises: { level: 1, perfect: 5 },
    replay: null,
  },
  {
    id: 'medias',
    title: 'Médias e tendência',
    desc: 'MME9, MME21, MMA50/200, inclinação e o ADX para separar tendência de lateral.',
    read: ['medias-moveis', 'adx'],
    exercises: { level: 1, perfect: 5 },
    replay: null,
  },
  {
    id: 'escalas',
    title: 'Visão em 3 escalas',
    desc: 'Contexto, setup e gatilho; nunca comprar contra a escala maior sem saber disso.',
    read: ['visao-fractal', 'painel-contexto'],
    exercises: { level: 3, perfect: 5 },
    replay: null,
  },
  {
    id: 'recuo',
    title: 'Recuo à média',
    desc: 'Comprar o recuo saudável na média que o ativo respeita.',
    read: ['recuo-a-media'],
    exercises: { level: 2, perfect: 5, setups: ['pullback'] },
    replay: { trades: 10, setups: ['pullback'] },
  },
  {
    id: 'consolidacao',
    title: 'Rompimento de consolidação',
    desc: 'Caixa estreita, Bollinger contraída e rompimento com volume.',
    read: ['rompimento-consolidacao', 'bandas-de-bollinger', 'volume'],
    exercises: { level: 2, perfect: 5, setups: ['consolidation'] },
    replay: { trades: 10, setups: ['consolidation'] },
  },
  {
    id: 'setups-9',
    title: 'Setups 9.1, 9.2 e 9.3',
    desc: 'Virada e continuação da MME9, com gatilho e stop exatos.',
    read: ['setup-9-1', 'setup-9-2', 'setup-9-3'],
    exercises: { level: 2, perfect: 5, setups: ['s91', 's92', 's93'] },
    replay: { trades: 10, setups: ['s91', 's92', 's93'] },
  },
  {
    id: 'elastico',
    title: 'Elástico (Bollinger de 3 desvios)',
    desc: 'Reversão à média: pouco frequente e contra a tendência do momento.',
    read: ['elastico'],
    exercises: { level: 2, perfect: 3, setups: ['elastic'] },
    replay: { trades: 5, setups: ['elastic'] },
  },
  {
    id: 'risco',
    title: 'Gestão de risco',
    desc: 'Tamanho pelo risco, R, expectativa, custos e por que 1% por trade.',
    read: ['gestao-de-risco', 'r-multiplo', 'expectativa', 'slippage-e-custos', 'drawdown'],
    exercises: null,
    replay: { trades: 20 },
  },
  {
    id: 'psicologia',
    title: 'Psicologia e disciplina',
    desc: 'Os cinco erros, anti-revanche e o que precisa estar provado antes do dinheiro real.',
    read: ['psicologia', 'antes-de-arriscar-dinheiro'],
    exercises: null,
    replay: { trades: 30 },
  },
];

export const trailReadSchema = z.array(z.string().min(1).max(60)).max(200);

export const exerciseCreateSchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  setups: z.array(z.string().min(2).max(20)).max(10).optional(),
});
export type ExerciseCreate = z.infer<typeof exerciseCreateSchema>;

export const exerciseAnswerSchema = z.object({
  answers: z.record(z.enum(['tem', 'qual', 'gatilho', 'stop', 'escala']), z.string().max(40)),
});
