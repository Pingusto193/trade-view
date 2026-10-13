import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  EXERCISE_WARMUP,
  buildExercise,
  exerciseOutcome,
  gradeExercise,
} from '../src/learn/exercise';
import { detectSetups } from '../src/setups/engine';
import { DEFAULT_SETUP_PARAMS } from '../src/setups/params';

const DAY = 86_400_000;
/** Passeio com fases de tendência (gera recuos, viradas da MME9 etc.). */
function series(n: number, seed = 42): Candle[] {
  let a = seed;
  const r = () => (a = (a * 1103515245 + 12345) >>> 0) / 2 ** 32;
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const drift = Math.sin(i / 40) * 0.006;
    const o = p;
    p = Math.max(5, p * Math.exp(drift + 0.02 * (r() + r() + r() - 1.5)));
    const hi = Math.max(o, p) * (1 + 0.008 * r());
    const lo = Math.min(o, p) * (1 - 0.008 * r());
    return {
      time: Date.UTC(2020, 0, 1) + i * DAY,
      open: +o.toFixed(2),
      high: +hi.toFixed(2),
      low: +lo.toFixed(2),
      close: +p.toFixed(2),
      volume: 1000 + Math.round(r() * 1000),
    };
  });
}

const base = {
  tf: '1d' as const,
  tz: 'UTC',
  tick: 0.01,
  decimals: 2,
  params: DEFAULT_SETUP_PARAMS,
};
let s = 7;
const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;

describe('exercícios de leitura', () => {
  const candles = series(700);

  it('positivo: gabarito do detector, perguntas do nível e nada do futuro', () => {
    const ex = buildExercise(candles, { ...base, level: 3, positive: true, rng });
    expect(ex).not.toBeNull();
    const e = ex!;
    expect(e.index).toBeGreaterThanOrEqual(EXERCISE_WARMUP);
    expect(e.answer.armed).toBe(true);
    expect(e.questions.map((q) => q.key)).toEqual(['tem', 'qual', 'gatilho', 'stop', 'escala']);
    // o gabarito sai igual olhando só até o candle da pergunta (sem look-ahead)
    const cut = detectSetups(candles.slice(0, e.index + 1), {
      params: DEFAULT_SETUP_PARAMS,
      tf: '1d',
      tz: 'UTC',
      tick: 0.01,
    });
    const armed = cut.filter((x) => x.id === e.answer.main!.id);
    expect(armed.at(-1)).toMatchObject({ state: 'armado', trigger: e.answer.main!.trigger });
    // a opção certa está entre as de preço
    const g = e.questions.find((q) => q.key === 'gatilho')!;
    expect(g.options.map((o) => o.value)).toContain(e.answer.main!.trigger.toFixed(2));
    expect(g.options.length).toBeGreaterThanOrEqual(3);

    const right = gradeExercise(
      e,
      {
        tem: 'sim',
        qual: e.answer.main!.setup,
        gatilho: e.answer.main!.trigger.toFixed(2),
        stop: e.answer.main!.stop.toFixed(2),
        escala: e.answer.main!.againstHigher ? 'sim' : 'nao',
      },
      2,
    );
    expect(right.every((q) => q.applicable && q.correct)).toBe(true);
    const wrong = gradeExercise(e, { tem: 'nao' }, 2);
    expect(wrong.filter((q) => q.correct)).toHaveLength(0);
  });

  it('negativo: mesmas perguntas (não entrega a resposta); "não" dispensa as outras', () => {
    const ex = buildExercise(candles, { ...base, level: 2, positive: false, rng });
    expect(ex).not.toBeNull();
    const e = ex!;
    expect(e.answer).toMatchObject({ armed: false, main: null, setups: [] });
    expect(e.questions.map((q) => q.key)).toEqual(['tem', 'qual', 'gatilho', 'stop']);
    const ok = gradeExercise(e, { tem: 'nao' }, 2);
    expect(ok[0]).toMatchObject({ correct: true, applicable: true });
    expect(ok.slice(1).every((q) => !q.applicable)).toBe(true);
    const bad = gradeExercise(e, { tem: 'sim', qual: 's91' }, 2);
    expect(bad.every((q) => q.applicable && !q.correct)).toBe(true);
  });

  it('filtro da trilha: só setups pedidos viram positivos; série curta → null', () => {
    const ex = buildExercise(candles, { ...base, level: 1, positive: true, setups: ['s91'], rng });
    if (ex) expect(ex.answer.main!.setup).toBe('s91');
    expect(
      buildExercise(candles.slice(0, 260), { ...base, level: 1, positive: true, rng }),
    ).toBeNull();
  });

  it('desfecho: conta o que o setup fez depois, com a série completa', () => {
    const ex = buildExercise(candles, { ...base, level: 1, positive: true, rng })!;
    const out = exerciseOutcome(candles, ex, base);
    expect(out.text.length).toBeGreaterThan(10);
    if (out.triggered && out.resultR !== null) expect(out.text).toMatch(/R \(setup puro/);
    const neg = buildExercise(candles, { ...base, level: 1, positive: false, rng })!;
    expect(exerciseOutcome(candles, neg, base).text).toMatch(/^Sem setup armado/);
  });
});
