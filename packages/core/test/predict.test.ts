import { readFileSync } from 'node:fs';
import type { Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  BaseRateModel,
  bbZone,
  calibration,
  predictReport,
  scorePredictions,
  SituationTracker,
  wilson,
  type ScoredPrediction,
  type Situation,
} from '../src';
import { Bars, DAY, T0 } from './setups/helpers';

const dir = new URL('./reference/', import.meta.url).pathname;
const REF = (JSON.parse(readFileSync(`${dir}candles.json`, 'utf8')) as { candles: Candle[] })
  .candles;

const sit = (patch: Partial<Situation> = {}): Situation => ({
  setup: 'nenhum',
  trend: 'alta',
  trend2: 'alta',
  trend3: 'indefinida',
  adx: 'tendencia',
  bb: 'superior',
  ...patch,
});

describe('Wilson', () => {
  it('valores conhecidos (95%)', () => {
    const a = wilson(5, 10)!;
    expect(a.lo).toBeCloseTo(0.2366, 4);
    expect(a.hi).toBeCloseTo(0.7634, 4);
    const b = wilson(0, 10)!;
    expect(b.lo).toBe(0);
    expect(b.hi).toBeCloseTo(0.2775, 4);
    expect(wilson(0, 0)).toBeNull();
  });
});

describe('taxas-base condicionais', () => {
  it('sem look-ahead: o caso só conta quando o candle i + h fecha', () => {
    const m = new BaseRateModel(2, 0);
    m.push(10, sit());
    m.push(11, sit());
    expect(m.estimate().levels.at(-1)!.n).toBe(0); // nenhum caso com 2 candles à frente ainda
    m.push(12, sit()); // fecha o caso 0 (10 → 12, subiu)
    const any = m.estimate().levels.at(-1)!;
    expect(any).toMatchObject({ n: 1, up: 1, rate: 1 });
  });

  it('casos da mesma situação não se sobrepõem', () => {
    const m = new BaseRateModel(3, 0);
    for (let i = 0; i < 10; i++) m.push(100 + i, sit()); // casos possíveis: i = 0..6
    // sem sobreposição: i = 0, 3, 6 → 3 casos (não 7)
    expect(m.estimate().levels.at(-1)!.n).toBe(3);
  });

  it('situação rara é puxada para a mais geral (encolhimento); sem casos = 50%', () => {
    const m = new BaseRateModel(1, 30);
    expect(m.estimate.bind(m)).toThrow(/sem candles/);
    m.push(10, sit());
    expect(m.estimate().p).toBe(0.5); // nada conferido ainda
    for (let i = 0; i < 60; i++) m.push(11 + i, sit()); // 60 altas na situação comum
    const rare = sit({ bb: 'acima', setup: 'venda' });
    const e = m.estimate(rare);
    expect(e.levels[0]).toMatchObject({ id: 'completa', n: 0, rate: null });
    // a completa não tem casos: herda a de "mesma tendência nas 3 escalas"
    expect(e.p).toBeCloseTo(e.levels[1]!.shrunk!, 12);
    // 60 de 60 subiram, mas a estimativa fica abaixo de 100% (puxada para 50% pelo encolhimento)
    expect(e.p).toBeGreaterThan(0.6);
    expect(e.p).toBeLessThan(1);
    expect(e.alwaysUpP).toBe(1);
    expect(e.persistUp).toBe(true);
  });
});

describe('placar contra as réguas', () => {
  const mk = (n: number, f: (i: number) => Partial<ScoredPrediction>): ScoredPrediction[] =>
    Array.from({ length: n }, (_, i) => ({
      time: T0 + i * DAY,
      p: 0.5,
      alwaysUpP: 0.5,
      persistUp: null,
      up: i % 2 === 0,
      ...f(i),
    }));

  it('poucos casos: não conclui nada', () => {
    const r = scorePredictions(mk(10, (i) => ({ p: i % 2 === 0 ? 0.9 : 0.1 })));
    expect(r.verdict).toBe('poucos-casos');
    expect(r.model.accuracy).toBe(1);
  });

  it('modelo igual à moeda: SEM VANTAGEM', () => {
    const r = scorePredictions(mk(100, () => ({})));
    expect(r.verdict).toBe('sem-vantagem');
    expect(r.model.accuracy).toBe(0.5);
    expect(r.model.brier).toBeCloseTo(0.25, 12);
  });

  it('"sempre sobe" ganha num mercado que sobe 70%: modelo de 65% não tem vantagem', () => {
    const r = scorePredictions(
      mk(200, (i) => ({
        up: i % 10 < 7,
        // acerta 65%: diz "sobe" nos 7 de alta menos 1 e erra 2 das 3 quedas
        p: i % 10 < 6 ? 0.6 : i % 10 === 6 ? 0.4 : i % 10 === 7 ? 0.4 : 0.6,
        alwaysUpP: 0.7,
      })),
    );
    expect(r.baselines['sempre-sobe'].accuracy).toBeCloseTo(0.7, 12);
    expect(r.best).toBe('sempre-sobe');
    expect(r.verdict).toBe('sem-vantagem');
  });

  it('vantagem só com o pior caso (Wilson) acima da melhor régua e Brier menor', () => {
    const r = scorePredictions(mk(200, (i) => ({ p: i % 2 === 0 ? 0.8 : 0.2 })));
    expect(r.model.accuracy).toBe(1);
    expect(r.model.ci!.lo).toBeGreaterThan(0.95);
    expect(r.verdict).toBe('vantagem');
  });

  it('calibração: faixas com n, média prevista e taxa real', () => {
    const bins = calibration([0.15, 0.18, 0.62, 0.65, 0.68], [false, true, true, true, false]);
    expect(bins.map((b) => [b.from, b.n])).toEqual([
      [0.1, 2],
      [0.6, 3],
    ]);
    expect(bins[1]!.upRate).toBeCloseTo(2 / 3, 12);
    expect(bins[0]!.meanP).toBeCloseTo(0.165, 12);
  });
});

describe('situação', () => {
  it('posição na Bollinger', () => {
    expect(bbZone(11, 10, 9, 8)).toBe('acima');
    expect(bbZone(9.5, 10, 9, 8)).toBe('superior');
    expect(bbZone(8.5, 10, 9, 8)).toBe('inferior');
    expect(bbZone(7, 10, 9, 8)).toBe('abaixo');
    expect(bbZone(9, Number.NaN, 9, 8)).toBe('indefinida');
  });

  it('começa indefinida e depois classifica a tendência de uma alta limpa', () => {
    const b = new Bars();
    for (let k = 0; k < 12; k++) {
      b.trend(10, 1.2, { range: 1.2 });
      b.trend(5, -1, { range: 0.7 });
    }
    const tr = new SituationTracker({ tf: '1d', tz: 'America/Sao_Paulo' });
    const out = b.list.map((c) => tr.push(c));
    expect(out[0]).toMatchObject({ trend: 'indefinida', adx: 'indefinido', bb: 'indefinida' });
    expect(out.at(-1)!.trend).toBe('alta');
    expect(tr.timeframes).toEqual(['1d', '1w', '1M']);
  });
});

describe('relatório da camada 1 (dados sintéticos de referência)', () => {
  const r = predictReport(REF, { tf: '1d', tz: 'America/Sao_Paulo' })!;

  it('três horizontes; histórico fora da amostra sem sobreposição', () => {
    expect(r.horizons.map((h) => h.horizon)).toEqual([1, 5, 20]);
    const h5 = r.horizons[1]!.history;
    // um ponto a cada 5 candles depois do aquecimento, e só com o futuro já fechado
    expect(h5.n).toBe(Math.floor((REF.length - 1 - 5 - 200) / 5) + 1);
    for (const h of r.horizons) {
      expect(h.current.p).toBeGreaterThan(0);
      expect(h.current.p).toBeLessThan(1);
      expect(h.history.verdict).not.toBe('vantagem'); // dados aleatórios: não pode achar vantagem
    }
  });

  it('sem look-ahead: a previsão gravada em t é a mesma de quem só tinha os candles até t', () => {
    const t = 400;
    const part = predictReport(REF.slice(0, t + 1), { tf: '1d', tz: 'America/Sao_Paulo' })!;
    for (const [k, h] of r.horizons.entries()) {
      const at = h.points.find((x) => x.time === REF[t]!.time);
      if (!at) continue; // não é ponto de avaliação deste horizonte
      expect(at.p).toBe(part.horizons[k]!.current.p);
      expect(at.alwaysUpP).toBe(part.horizons[k]!.current.alwaysUpP);
    }
    expect(r.horizons[0]!.points.some((x) => x.time === REF[t]!.time)).toBe(true);
  });

  it('candles de menos: null (nada inventado)', () => {
    expect(predictReport(REF.slice(0, 150), { tf: '1d', tz: 'UTC' })).toBeNull();
  });
});
