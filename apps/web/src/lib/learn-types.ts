import type {
  Exercise,
  ExerciseLevel,
  ExerciseOutcome,
  GradedQuestion,
  SetupId,
} from '@radar/core';
import type { Candle, SymbolMeta, Timeframe } from '@radar/shared';

/** Respostas da API de exercícios e trilha (apps/server/src/learn/service.ts). */
export interface ExerciseView {
  id: string;
  level: ExerciseLevel;
  tf: Timeframe;
  meta: SymbolMeta;
  candles: Candle[];
  questions: Exercise['questions'];
}

export interface ExerciseResult {
  graded: GradedQuestion[];
  score: number;
  total: number;
  outcome: ExerciseOutcome;
  reason: string | null;
  setups: SetupId[];
  future: Candle[];
  meta: SymbolMeta;
}

export interface TrailProgress {
  modules: {
    id: string;
    read: { slug: string; done: boolean }[];
    exercises: { done: number; need: number } | null;
    replay: { done: number; need: number } | null;
    complete: boolean;
  }[];
}
