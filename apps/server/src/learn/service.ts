import { randomUUID } from 'node:crypto';
import {
  EXERCISE_AHEAD_BARS,
  buildExercise,
  exerciseOutcome,
  gradeExercise,
  type Exercise,
  type ExerciseLevel,
  type ExerciseOutcome,
  type GradedQuestion,
  type QuestionKey,
  type ReplayBook,
  type SetupId,
} from '@radar/core';
import {
  TRAIL,
  UNIVERSES,
  type Candle,
  type ExerciseCreate,
  type SymbolMeta,
  type Timeframe,
} from '@radar/shared';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { exercises, replaySessions } from '../db/schema';
import type { MarketService } from '../market/service';
import { readPrefs, userSetupParams } from '../prefs';

export class LearnError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Candles pedidos à fonte por exercício (diário). */
const FETCH = 1500;
/** Candles mostrados antes da pergunta (indicadores precisam de ~200 para a MMA200). */
const SHOW = 300;
const ATTEMPTS = 6;
const TF: Timeframe = '1d';

export interface ExerciseView {
  id: string;
  level: ExerciseLevel;
  tf: Timeframe;
  /** Ativo oculto até responder. */
  meta: SymbolMeta;
  candles: Candle[];
  questions: Exercise['questions'];
}

export interface ExerciseResult {
  graded: GradedQuestion[];
  score: number;
  total: number;
  outcome: ExerciseOutcome;
  /** Explicação do detector (o "porquê"), quando havia setup. */
  reason: string | null;
  setups: SetupId[];
  /** Candles depois da pergunta ("o que o preço fez"). */
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

const mask = (m: SymbolMeta): SymbolMeta => ({
  ...m,
  id: 'oculto',
  symbol: 'Ativo sorteado',
  name: 'Ativo sorteado',
});

/** Exercícios de leitura e trilha (SPEC §13). */
export class LearnService {
  constructor(
    private readonly db: Db,
    private readonly market: MarketService,
    private readonly simulated: boolean,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  async create(userId: number, input: ExerciseCreate): Promise<ExerciseView> {
    const level = input.level as ExerciseLevel;
    const focus = (input.setups ?? null) as SetupId[] | null;
    const params = userSetupParams(readPrefs(this.db, userId));
    // metade com setup, metade sem ("não operar" também é resposta); com foco da trilha, mais positivos
    let positive = this.random() < (focus ? 0.7 : 0.5);
    const pool = this.simulated
      ? [...UNIVERSES.sim.symbols]
      : [...UNIVERSES.b3.symbols, ...UNIVERSES.cripto.symbols, ...UNIVERSES.eua.symbols];
    let lastErr = 'nenhum ativo tentado';
    for (let i = 0; i < ATTEMPTS && pool.length; i++) {
      const symbolId = pool.splice(Math.floor(this.random() * pool.length), 1)[0] as string;
      try {
        const resp = await this.market.getCandles(symbolId, TF, FETCH);
        const candles = resp.lastCandleOpen ? resp.candles.slice(0, -1) : resp.candles;
        const meta = resp.meta;
        const opts = {
          level,
          tf: TF,
          tz: meta.session.timezone,
          tick: meta.tickSize,
          decimals: meta.priceDecimals,
          params,
          ...(focus ? { setups: focus } : {}),
          rng: this.random,
        };
        let ex = buildExercise(candles, { ...opts, positive });
        if (!ex) {
          positive = !positive;
          ex = buildExercise(candles, { ...opts, positive });
        }
        if (!ex) {
          lastErr = `${meta.symbol}: sem candle adequado (${candles.length} candles na fonte)`;
          continue;
        }
        const outcome = exerciseOutcome(candles, ex, {
          tf: TF,
          tz: meta.session.timezone,
          tick: meta.tickSize,
          params,
        });
        const from = Math.max(0, ex.index - SHOW + 1);
        const stored = candles.slice(from, ex.index + 1 + EXERCISE_AHEAD_BARS);
        const shown = ex.index - from + 1;
        const id = randomUUID();
        this.db
          .insert(exercises)
          .values({
            id,
            userId,
            level,
            setups: focus ? JSON.stringify(focus) : null,
            symbolId,
            tf: TF,
            meta: JSON.stringify(meta),
            candles: JSON.stringify(stored),
            shown,
            questions: JSON.stringify(ex.questions),
            answer: JSON.stringify(ex.answer),
            outcome: JSON.stringify(outcome),
            createdAt: this.now(),
          })
          .run();
        return {
          id,
          level,
          tf: TF,
          meta: mask(meta),
          candles: stored.slice(0, shown),
          questions: ex.questions,
        };
      } catch (e) {
        lastErr = (e as Error).message;
      }
    }
    throw new LearnError(`Não consegui montar um exercício agora. Último motivo: ${lastErr}`);
  }

  answer(userId: number, id: string, given: Partial<Record<QuestionKey, string>>): ExerciseResult {
    const r = this.db
      .select()
      .from(exercises)
      .where(and(eq(exercises.userId, userId), eq(exercises.id, id)))
      .get();
    if (!r) throw new LearnError('Exercício não encontrado.', 404);
    const meta = JSON.parse(r.meta) as SymbolMeta;
    const questions = JSON.parse(r.questions) as Exercise['questions'];
    const answer = JSON.parse(r.answer) as Exercise['answer'];
    // respondeu uma vez, vale aquela resposta (sem tentar de novo até acertar)
    const graded: GradedQuestion[] = r.graded
      ? (JSON.parse(r.graded) as GradedQuestion[])
      : gradeExercise({ questions, answer }, given, meta.priceDecimals);
    const applicable = graded.filter((g) => g.applicable);
    const score = applicable.filter((g) => g.correct).length;
    if (!r.graded)
      this.db
        .update(exercises)
        .set({
          given: JSON.stringify(given),
          graded: JSON.stringify(graded),
          score,
          total: applicable.length,
          answeredAt: this.now(),
        })
        .where(eq(exercises.id, id))
        .run();
    const candles = JSON.parse(r.candles) as Candle[];
    return {
      graded,
      score,
      total: applicable.length,
      outcome: JSON.parse(r.outcome) as ExerciseOutcome,
      reason: answer.main?.reason ?? null,
      setups: answer.setups,
      future: candles.slice(r.shown),
      meta,
    };
  }

  /** Resumo por nível: quantos respondidos e quantos 100% certos. */
  stats(userId: number): { level: number; answered: number; perfect: number }[] {
    const rows = this.answered(userId);
    return [1, 2, 3].map((level) => {
      const l = rows.filter((r) => r.level === level);
      return { level, answered: l.length, perfect: l.filter((r) => r.score === r.total).length };
    });
  }

  trail(userId: number): TrailProgress {
    const read = new Set(readPrefs(this.db, userId).trailRead);
    const answered = this.answered(userId);
    const trades = this.db
      .select({ book: replaySessions.book })
      .from(replaySessions)
      .where(eq(replaySessions.userId, userId))
      .all()
      .flatMap((r) => (JSON.parse(r.book) as ReplayBook).trades)
      .filter((t) => t.plan?.released);
    return {
      modules: TRAIL.map((m) => {
        const ex = m.exercises
          ? {
              done: answered.filter((a) => {
                if (a.level < (m.exercises?.level ?? 1) || a.score !== a.total) return false;
                if (!m.exercises?.setups) return true;
                const focus = a.setups ? (JSON.parse(a.setups) as string[]) : null;
                return !!focus && focus.every((s) => m.exercises?.setups?.includes(s));
              }).length,
              need: m.exercises.perfect,
            }
          : null;
        const rp = m.replay
          ? {
              done: trades.filter(
                (t) => !m.replay?.setups || m.replay.setups.includes(t.plan?.setup ?? ''),
              ).length,
              need: m.replay.trades,
            }
          : null;
        const readItems = m.read.map((slug) => ({ slug, done: read.has(slug) }));
        return {
          id: m.id,
          read: readItems,
          exercises: ex,
          replay: rp,
          complete:
            readItems.every((x) => x.done) &&
            (!ex || ex.done >= ex.need) &&
            (!rp || rp.done >= rp.need),
        };
      }),
    };
  }

  private answered(userId: number) {
    return this.db
      .select({
        level: exercises.level,
        setups: exercises.setups,
        score: exercises.score,
        total: exercises.total,
      })
      .from(exercises)
      .where(and(eq(exercises.userId, userId), isNotNull(exercises.answeredAt)))
      .orderBy(desc(exercises.createdAt))
      .all();
  }
}
