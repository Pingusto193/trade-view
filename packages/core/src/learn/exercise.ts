import type { Candle, Timeframe } from '@radar/shared';
import { roundTick } from '../setups/fills';
import { detectSetups } from '../setups/engine';
import type { SetupParams } from '../setups/params';
import { SETUP_LABEL, type ExitKind, type SetupEvent, type SetupId } from '../setups/types';

/**
 * Exercícios de leitura (SPEC §13): uma situação REAL do passado, cortada no último candle fechado.
 * As respostas vêm dos mesmos detectores do gráfico (nunca de um gabarito escrito à mão), e o "depois"
 * mostra o que o preço fez de verdade.
 *
 * Níveis (dificuldade crescente, decisão nossa — ADR-0026):
 * 1. Tem setup de compra armado no último candle? Qual?
 * 2. + onde fica o gatilho e onde fica o stop.
 * 3. + a escala maior está contra a compra?
 */
export type ExerciseLevel = 1 | 2 | 3;
export const EXERCISE_LEVELS: readonly ExerciseLevel[] = [1, 2, 3];

/** Candles mostrados antes do candle da pergunta (o resto do aquecimento fica no servidor). */
export const EXERCISE_SHOW_BARS = 150;
/** Candles revelados depois da resposta ("o que o preço fez em seguida"). */
export const EXERCISE_AHEAD_BARS = 30;
/** Candles mínimos antes da pergunta para os detectores e indicadores estarem "quentes". */
export const EXERCISE_WARMUP = 250;

export type QuestionKey = 'tem' | 'qual' | 'gatilho' | 'stop' | 'escala';

export interface ExerciseQuestion {
  key: QuestionKey;
  text: string;
  options: { value: string; label: string }[];
}

export interface ExerciseAnswer {
  armed: boolean;
  /** Setups de compra armados no candle da pergunta (qualquer um vale em "qual?"). */
  setups: SetupId[];
  /** Ocorrência usada no gabarito (gatilho, stop, escala). */
  main: {
    id: string;
    setup: SetupId;
    trigger: number;
    stop: number;
    againstHigher: boolean;
    reason: string;
  } | null;
}

export interface Exercise {
  level: ExerciseLevel;
  /** Índice (na série recebida) do último candle mostrado = candle da pergunta. */
  index: number;
  questions: ExerciseQuestion[];
  answer: ExerciseAnswer;
}

export interface ExerciseOutcome {
  /** A ocorrência acionou depois? Com que saída e R (setup puro, sem custos)? */
  triggered: boolean;
  exit: ExitKind | null;
  resultR: number | null;
  /** Texto curto do que aconteceu. */
  text: string;
}

export interface GradedQuestion {
  key: QuestionKey;
  /** false = não se aplica (não havia setup e você respondeu "não"): não conta na nota. */
  applicable: boolean;
  correct: boolean;
  given: string | null;
  expected: string;
  /** Texto do valor certo para mostrar. */
  expectedLabel: string;
}

const YES = 'sim';
const NO = 'nao';

/** Ocorrências de compra armadas (ainda não acionadas nem encerradas) no candle `i`. */
function armedAt(events: readonly SetupEvent[], i: number): SetupEvent[] {
  const byId = new Map<string, SetupEvent[]>();
  for (const e of events) {
    if (e.side !== 'buy' || e.index > i) continue;
    byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
  }
  const out: SetupEvent[] = [];
  for (const evs of byId.values()) {
    const last = evs[evs.length - 1] as SetupEvent;
    if (last.state === 'armado' && last.trigger !== undefined && last.stop !== undefined)
      out.push(last);
  }
  return out;
}

function priceOptions(
  correct: number,
  spread: number,
  tick: number,
  decimals: number,
  rng: () => number,
) {
  const fmt = (v: number) => v.toFixed(decimals);
  const vals = new Set<string>([fmt(correct)]);
  const steps = [0.5, -0.5, 1, -1, 1.5, -1.5];
  for (const k of steps) {
    if (vals.size >= 4) break;
    const v = roundTick(correct + k * spread, tick);
    if (v > 0) vals.add(fmt(v));
  }
  const list = [...vals];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j] as string, list[i] as string];
  }
  return list.map((v) => ({ value: v, label: v.replace('.', ',') }));
}

/**
 * Monta um exercício a partir de uma série real. `positive` decide se a pergunta cai num candle com
 * setup armado ou num sem nada (os negativos também ensinam: "não operar" é resposta).
 * Devolve null quando a série não tem um candle adequado.
 */
export function buildExercise(
  candles: readonly Candle[],
  o: {
    level: ExerciseLevel;
    tf: Timeframe;
    tz: string;
    tick: number;
    decimals: number;
    params: SetupParams;
    positive: boolean;
    /** Só estes setups contam como positivos (trilha); padrão: todos. */
    setups?: readonly SetupId[];
    rng: () => number;
  },
): Exercise | null {
  const events = detectSetups(candles, { params: o.params, tf: o.tf, tz: o.tz, tick: o.tick });
  const lo = EXERCISE_WARMUP;
  const hi = candles.length - 1 - EXERCISE_AHEAD_BARS;
  if (hi <= lo) return null;
  const candidates: number[] = [];
  for (let i = lo; i <= hi; i++) {
    const armed = armedAt(events, i).filter((e) => !o.setups || o.setups.includes(e.setup));
    if (o.positive ? armed.length > 0 : armedAt(events, i).length === 0) candidates.push(i);
  }
  if (!candidates.length) return null;
  const index = candidates[Math.floor(o.rng() * candidates.length)] as number;
  const armed = armedAt(events, index).filter((e) => !o.setups || o.setups.includes(e.setup));
  const all = armedAt(events, index);
  const main = o.positive ? (armed[Math.floor(o.rng() * armed.length)] as SetupEvent) : null;
  const answer: ExerciseAnswer = {
    armed: all.length > 0,
    setups: [...new Set(all.map((e) => e.setup))],
    main: main
      ? {
          id: main.id,
          setup: main.setup,
          trigger: main.trigger as number,
          stop: main.stop as number,
          againstHigher: main.againstHigher === true,
          reason: main.reason,
        }
      : null,
  };
  const last = candles[index] as Candle;
  const spread = Math.max(last.high - last.low, o.tick * 4);
  // sem setup, as opções de preço giram em torno da máxima/mínima do último candle (todas erradas):
  // a lista de perguntas é a mesma nos dois casos, senão contar as perguntas entregaria a resposta
  const trig = main ? (main.trigger as number) : roundTick(last.high + o.tick, o.tick);
  const stp = main ? (main.stop as number) : roundTick(last.low - o.tick, o.tick);
  const questions: ExerciseQuestion[] = [
    {
      key: 'tem',
      text: 'No último candle, há algum setup de COMPRA armado (esperando o gatilho)?',
      options: [
        { value: YES, label: 'Sim' },
        { value: NO, label: 'Não' },
      ],
    },
  ];
  questions.push({
    key: 'qual',
    text: 'Se sim: qual setup?',
    options: (Object.keys(SETUP_LABEL) as SetupId[]).map((s) => ({
      value: s,
      label: SETUP_LABEL[s],
    })),
  });
  if (o.level >= 2) {
    questions.push({
      key: 'gatilho',
      text: 'Se sim: onde fica o gatilho de entrada?',
      options: priceOptions(trig, spread, o.tick, o.decimals, o.rng),
    });
    questions.push({
      key: 'stop',
      text: 'Se sim: onde fica o stop?',
      options: priceOptions(stp, spread, o.tick, o.decimals, o.rng),
    });
  }
  if (o.level >= 3)
    questions.push({
      key: 'escala',
      text: 'Se sim: a escala maior está CONTRA esta compra (em baixa)?',
      options: [
        { value: YES, label: 'Sim, está contra' },
        { value: NO, label: 'Não' },
      ],
    });
  return { level: o.level, index, questions, answer };
}

/** Corrige as respostas. Perguntas sem resposta contam como erradas. */
export function gradeExercise(
  ex: Pick<Exercise, 'questions' | 'answer'>,
  given: Partial<Record<QuestionKey, string>>,
  decimals: number,
): GradedQuestion[] {
  const a = ex.answer;
  return ex.questions.map((q): GradedQuestion => {
    const g = given[q.key] ?? null;
    if (q.key !== 'tem' && !a.main) {
      // não havia setup: "não" na primeira pergunta dispensa as outras; "sim" erra todas
      const saidYes = given.tem === YES;
      return {
        key: q.key,
        applicable: saidYes,
        correct: false,
        given: g,
        expected: '',
        expectedLabel: 'não havia setup armado',
      };
    }
    let expected: string;
    let ok: boolean;
    switch (q.key) {
      case 'tem':
        expected = a.armed ? YES : NO;
        ok = g === expected;
        break;
      case 'qual':
        expected = a.main?.setup ?? '';
        ok = g !== null && a.setups.includes(g as SetupId);
        break;
      case 'gatilho':
        expected = (a.main?.trigger ?? 0).toFixed(decimals);
        ok = g === expected;
        break;
      case 'stop':
        expected = (a.main?.stop ?? 0).toFixed(decimals);
        ok = g === expected;
        break;
      case 'escala':
        expected = a.main?.againstHigher ? YES : NO;
        ok = g === expected;
        break;
    }
    const label = q.options.find((x) => x.value === expected)?.label ?? expected;
    return { key: q.key, applicable: true, correct: ok, given: g, expected, expectedLabel: label };
  });
}

/** O que aconteceu com a ocorrência do gabarito nos candles revelados depois da pergunta. */
export function exerciseOutcome(
  candles: readonly Candle[],
  ex: Pick<Exercise, 'index' | 'answer'>,
  o: { tf: Timeframe; tz: string; tick: number; params: SetupParams },
): ExerciseOutcome {
  const m = ex.answer.main;
  const until = Math.min(candles.length - 1, ex.index + EXERCISE_AHEAD_BARS);
  const first = candles[ex.index + 1];
  const lastC = candles[until];
  const move =
    first && lastC
      ? `Nos ${until - ex.index} candles seguintes o preço foi de ${first.open} a ${lastC.close} (${(((lastC.close - first.open) / first.open) * 100).toFixed(1).replace('.', ',')}%).`
      : '';
  if (!m)
    return {
      triggered: false,
      exit: null,
      resultR: null,
      text: `Sem setup armado. ${move}`.trim(),
    };
  const events = detectSetups(candles.slice(0, until + 1), {
    params: o.params,
    tf: o.tf,
    tz: o.tz,
    tick: o.tick,
  }).filter((e) => e.id === m.id && e.index > ex.index);
  const trig = events.find((e) => e.state === 'acionado');
  const end = [...events].reverse().find((e) => e.state === 'encerrado' && e.partial === undefined);
  if (!trig) {
    const why = end
      ? 'o setup desarmou antes de acionar'
      : 'o gatilho não foi atingido no período mostrado';
    return {
      triggered: false,
      exit: end?.exit ?? null,
      resultR: null,
      text: `Não acionou: ${why}. ${move}`.trim(),
    };
  }
  if (!end || end.resultR === undefined)
    return {
      triggered: true,
      exit: null,
      resultR: null,
      text: `Acionou e ainda estava aberto no fim do período mostrado. ${move}`.trim(),
    };
  const r = end.resultR;
  return {
    triggered: true,
    exit: end.exit ?? null,
    resultR: r,
    text: `Acionou e terminou em ${r >= 0 ? '+' : ''}${r.toFixed(2).replace('.', ',')}R (setup puro, sem custos). ${move}`.trim(),
  };
}
