import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PA,
  PivotTracker,
  SeriesBuffer,
  doji,
  exitFill,
  hammer,
  insideBar,
  stopEntryFill,
  strongBull,
  volumeClass,
  volumeDrying,
} from '../../src';
import { Bars } from './helpers';

function buf(b: Bars): SeriesBuffer {
  const s = new SeriesBuffer();
  for (const c of b.list) s.push(c);
  return s;
}

describe('primitivas de candle', () => {
  it('inside bar: máxima menor e mínima maior que a anterior', () => {
    const s = buf(new Bars().add(10, 12, 8, 11).add(11, 11.5, 9, 10).add(10, 12.5, 9.5, 11));
    expect(insideBar(s, 1)).toBe(true);
    expect(insideBar(s, 2)).toBe(false);
  });

  it('martelo: sombra inferior longa, sombra superior curta, corpo no terço superior', () => {
    const s = buf(new Bars().add(10, 10.2, 7, 10.1).add(10, 12, 7, 9.9));
    expect(hammer(s, 0, DEFAULT_PA)).toBe(true);
    expect(hammer(s, 1, DEFAULT_PA)).toBe(false); // sombra superior grande
  });

  it('doji: corpo até 10% da amplitude', () => {
    const s = buf(new Bars().add(10, 11, 9, 10.1).add(10, 11, 9, 10.5));
    expect(doji(s, 0, DEFAULT_PA)).toBe(true);
    expect(doji(s, 1, DEFAULT_PA)).toBe(false);
  });

  it('candle de força compara com o corpo médio dos 20 ANTERIORES', () => {
    const b = new Bars();
    for (let i = 0; i < 20; i++) b.add(100, 100.6, 99.4, i % 2 ? 100.5 : 99.5); // corpos de 0,5
    b.add(100, 101.05, 99.9, 101); // corpo 1,0 = 2 × média; fecha no quarto superior
    b.add(100, 101, 99.9, 100.6); // corpo 0,6 < 1,5 × média
    const s = buf(b);
    expect(strongBull(s, 20, DEFAULT_PA)).toBe(true);
    expect(strongBull(s, 21, DEFAULT_PA)).toBe(false);
  });

  it('volume relativo à média dos 21 anteriores', () => {
    const b = new Bars();
    for (let i = 0; i < 22; i++) b.to(100, { v: 1000 });
    b.to(100, { v: 2100 }).to(100, { v: 1600 }).to(100, { v: 1100 }).to(100, { v: 500 });
    const s = buf(b);
    expect(volumeClass(s, 22, DEFAULT_PA)).toBe('estrondoso');
    expect(volumeClass(s, 23, DEFAULT_PA)).toBe('muito-acima');
    expect(volumeClass(s, 24, DEFAULT_PA)).toBe('acima');
    expect(volumeClass(s, 25, DEFAULT_PA)).toBe('abaixo');
  });

  it('volume secando: média menor que a anterior e inclinação negativa', () => {
    const b = new Bars();
    for (let i = 0; i < 25; i++) b.to(100, { v: 1000 });
    for (const v of [900, 800, 700, 600]) b.to(99, { v });
    const s = buf(b);
    expect(volumeDrying(s, 25, 28)).toBe(true);
    expect(volumeDrying(s, 0, 5)).toBe(false);
  });
});

describe('pivôs (topos e fundos) sem look-ahead', () => {
  it('o topo só existe N candles depois', () => {
    const b = new Bars();
    for (const c of [10, 11, 12, 15, 12, 11, 10]) b.add(c, c + 0.5, c - 0.5, c);
    const s = new SeriesBuffer();
    const p = new PivotTracker(2);
    const confirmedAt: number[] = [];
    b.list.forEach((c, t) => {
      s.push(c);
      for (const pv of p.step(s, t)) if (pv.type === 'high') confirmedAt.push(t);
    });
    expect(p.highs[0]).toMatchObject({ index: 3, confirmedAt: 5, price: 15.5 });
    expect(confirmedAt).toEqual([5]);
  });

  it('estrutura: dois topos e dois fundos ascendentes = alta; pivô de alta rompendo o topo intermediário', () => {
    const b = new Bars();
    // fundos 10 e 12, topos 15 e 17, fundo seguinte 14 (maior que 12)
    for (const c of [13, 12, 10, 12, 15, 13, 12, 14, 17, 15, 14, 15, 16, 18])
      b.add(c, c + 0.3, c - 0.3, c);
    const s = new SeriesBuffer();
    const p = new PivotTracker(2);
    let pivotAt = -1;
    b.list.forEach((c, t) => {
      s.push(c);
      p.step(s, t);
      if (pivotAt < 0 && p.bullishPivot(s, t)) pivotAt = t;
    });
    expect(p.trend()).toBe('alta');
    expect(pivotAt).toBeGreaterThan(0);
  });
});

describe('modelo de preenchimento conservador', () => {
  const c = (o: number, h: number, l: number, cl: number) => ({
    time: 0,
    open: o,
    high: h,
    low: l,
    close: cl,
    volume: 1,
  });
  it('entrada stop: no gatilho, ou na abertura se houver gap (pior preço)', () => {
    expect(stopEntryFill(c(10, 12, 9.5, 11), 'buy', 11)).toBe(11);
    expect(stopEntryFill(c(11.5, 12, 11.2, 11.8), 'buy', 11)).toBe(11.5);
    expect(stopEntryFill(c(10, 10.9, 9.5, 10.5), 'buy', 11)).toBeNull();
    expect(stopEntryFill(c(9, 9.5, 8, 8.5), 'sell', 9.2)).toBe(9);
  });

  it('stop com gap contra preenche na abertura; stop e alvo no mesmo candle = stop', () => {
    expect(exitFill(c(8, 9, 7.5, 8.5), 'buy', 9, 12, false)).toEqual({
      price: 8,
      kind: 'stop',
      gap: true,
    });
    expect(exitFill(c(10, 12.5, 8.5, 11), 'buy', 9, 12, false)).toEqual({
      price: 9,
      kind: 'stop',
      gap: false,
    });
    expect(exitFill(c(10, 12.5, 9.5, 12), 'buy', 9, 12, false)).toEqual({
      price: 12,
      kind: 'alvo',
      gap: false,
    });
  });

  it('alvo com gap a favor preenche no alvo (conservador) ou na abertura (opção)', () => {
    expect(exitFill(c(13, 14, 12.8, 13.5), 'buy', 9, 12, false)).toEqual({
      price: 12,
      kind: 'alvo',
      gap: true,
    });
    expect(exitFill(c(13, 14, 12.8, 13.5), 'buy', 9, 12, false, { targetGap: 'open' })?.price).toBe(
      13,
    );
  });

  it('no candle da entrada só o stop vale', () => {
    expect(exitFill(c(10, 13, 9.5, 12), 'buy', 9, 12, true)).toBeNull();
    expect(exitFill(c(10, 13, 8.5, 12), 'buy', 9, 12, true)?.kind).toBe('stop');
  });
});
