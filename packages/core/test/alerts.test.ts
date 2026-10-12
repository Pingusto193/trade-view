import type { AlertCondition, Candle } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import { AlertRuntime, TimeIndex, detectSetups, lineLevelAt, type RuntimeAlert } from '../src';
import { Bars, DAY, T0 } from './setups/helpers';

const rt = () => new AlertRuntime({ tf: '1d', tz: 'America/Sao_Paulo', tick: 0.01 });
const alert = (
  condition: AlertCondition,
  trigger: 'touch' | 'close' = 'close',
  extra: Partial<RuntimeAlert> = {},
): RuntimeAlert => ({ id: 'a1', condition, trigger, ...extra });
const c = (i: number, o: number, h: number, l: number, cl: number): Candle => ({
  time: T0 + i * DAY,
  open: o,
  high: h,
  low: l,
  close: cl,
  volume: 1000,
});

describe('alerta de preço', () => {
  const hist = [c(0, 9, 9.5, 8.5, 9), c(1, 9, 9.6, 8.8, 9.4)];

  it('no fechamento: só dispara quando FECHA do outro lado, uma vez (borda)', () => {
    const r = rt();
    r.warmup(hist, false);
    r.add(alert({ kind: 'price', level: 10, direction: 'up' }));
    // pavio acima, fechamento abaixo → não dispara
    expect(r.update(c(2, 9.4, 10.5, 9.3, 9.8), true)).toEqual([]);
    const hits = r.update(c(3, 9.8, 10.4, 9.7, 10.2), true);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ alertId: 'a1', candleTime: T0 + 3 * DAY, price: 10 });
    expect(hits[0]!.text).toContain('Fechamento cruzou para cima');
    // continua acima → não repete
    expect(r.update(c(4, 10.2, 10.8, 10.1, 10.6), true)).toEqual([]);
    // volta para baixo e cruza de novo → dispara de novo (o servidor decide se rearma)
    expect(r.update(c(5, 10.6, 10.6, 9.5, 9.6), true)).toEqual([]);
    expect(r.update(c(6, 9.6, 10.3, 9.6, 10.1), true)).toHaveLength(1);
  });

  it('no toque: dispara pela máxima do candle em formação, sem esperar o fechamento', () => {
    const r = rt();
    r.warmup(hist, false);
    r.add(alert({ kind: 'price', level: 10, direction: 'up' }, 'touch'));
    expect(r.update(c(2, 9.4, 9.9, 9.3, 9.8), false)).toEqual([]);
    const hits = r.update(c(2, 9.4, 10.01, 9.3, 9.9), false);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toContain('Preço cruzou para cima');
    // mesmo candle continua acima: não repete
    expect(r.update(c(2, 9.4, 10.2, 9.3, 10.1), false)).toEqual([]);
  });

  it('para baixo, espelhado', () => {
    const r = rt();
    r.warmup(hist, false);
    r.add(alert({ kind: 'price', level: 9, direction: 'down' }, 'touch'));
    expect(r.update(c(2, 9.4, 9.5, 8.99, 9.1), false)).toHaveLength(1);
  });

  it('o histórico de aquecimento nunca dispara; candles velhos e repetidos são ignorados', () => {
    const r = rt();
    r.add(alert({ kind: 'price', level: 10, direction: 'up' }));
    r.warmup([...hist, c(2, 9.4, 11, 9.3, 10.5)], false);
    expect(r.lastClosedTime).toBe(T0 + 2 * DAY);
    // repetição do mesmo candle (reconexão) e candle mais antigo: nada
    expect(r.update(c(2, 9.4, 11, 9.3, 10.5), true)).toEqual([]);
    expect(r.update(c(1, 9, 9.6, 8.8, 9.4), true)).toEqual([]);
  });

  it('candle em formação mais novo sem o fechamento do anterior: fecha o anterior antes', () => {
    const r = rt();
    r.warmup(hist, false);
    r.add(alert({ kind: 'price', level: 10, direction: 'up' }));
    r.update(c(2, 9.4, 10.5, 9.3, 10.3), false); // em formação, acima
    const hits = r.update(c(3, 10.3, 10.4, 10.2, 10.3), false); // novo candle: o 2 fechou
    expect(hits).toHaveLength(1);
    expect(hits[0]!.candleTime).toBe(T0 + 2 * DAY);
    expect(r.lastClosedTime).toBe(T0 + 2 * DAY);
  });
});

describe('alerta de desenho', () => {
  const hist = [c(0, 9, 9.5, 8.5, 9), c(1, 9, 9.6, 8.8, 9.4)];

  it('zona: entrar e sair', () => {
    const r = rt();
    r.warmup(hist, false);
    r.add(
      alert({ kind: 'drawing', drawingId: 'd1', event: 'enter' }, 'close', {
        drawing: {
          kind: 'zone',
          points: [
            { time: T0, price: 11 },
            { time: T0 + DAY, price: 10 },
          ],
        },
      }),
    );
    r.add({
      id: 'a2',
      condition: { kind: 'drawing', drawingId: 'd1', event: 'exit' },
      trigger: 'touch',
      drawing: {
        kind: 'zone',
        points: [
          { time: T0, price: 11 },
          { time: T0 + DAY, price: 10 },
        ],
      },
    });
    const enter = r.update(c(2, 9.4, 10.6, 9.3, 10.5), true);
    expect(enter.map((h) => h.alertId)).toEqual(['a1']);
    expect(enter[0]!.text).toContain('entrou na zona 10,00–11,00');
    // dentro; no toque sai pela máxima acima de 11
    const exit = r.update(c(3, 10.5, 11.2, 10.4, 10.9), false);
    expect(exit.map((h) => h.alertId)).toEqual(['a2']);
  });

  it('linha de tendência é avaliada no espaço de BARRAS, como o gráfico desenha', () => {
    // pontos em barras 0 (preço 10) e 2 (preço 12): na barra 4 vale 14, mesmo com buraco de tempo
    const times = [T0, T0 + DAY, T0 + 2 * DAY, T0 + 5 * DAY, T0 + 6 * DAY];
    const idx = new TimeIndex(times);
    const pts = [
      { time: T0, price: 10 },
      { time: T0 + 2 * DAY, price: 12 },
    ];
    expect(lineLevelAt(pts, idx, T0 + 6 * DAY)).toBeCloseTo(14);
    expect(lineLevelAt(pts, idx, T0 + 5 * DAY)).toBeCloseTo(13);
  });

  it('linha de tendência: cruzar para cima no fechamento', () => {
    const r = rt();
    const b = new Bars().trend(5, 0.1); // fechamentos 100,1 … 100,5
    r.warmup(b.list, false);
    r.add(
      alert({ kind: 'drawing', drawingId: 'd', event: 'cross-up' }, 'close', {
        drawing: {
          kind: 'trend',
          points: [
            { time: T0, price: 101 },
            { time: T0 + 4 * DAY, price: 101.4 },
          ],
        },
      }),
    );
    // barra 5: a linha vale 101,5; fechar 101,4 não cruza, 101,7 na barra 6 (linha 101,6) cruza
    expect(r.update({ ...b.last, time: T0 + 5 * DAY, close: 101.4, high: 101.5 }, true)).toEqual(
      [],
    );
    const hits = r.update(
      { time: T0 + 6 * DAY, open: 101.4, high: 101.8, low: 101.3, close: 101.7, volume: 1 },
      true,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.price).toBeCloseTo(101.6);
  });

  it('desenho sem geometria não avalia (servidor marca o alerta)', () => {
    const r = rt();
    r.warmup(hist, false);
    r.add(alert({ kind: 'drawing', drawingId: 'sumiu', event: 'cross-up' }));
    expect(r.update(c(2, 9, 99, 1, 50), true)).toEqual([]);
  });
});

describe('alerta de indicador', () => {
  it('MME virou para cima: um disparo no candle da virada', () => {
    const b = new Bars().trend(15, -0.5); // MME9 caindo
    const r = rt();
    r.warmup(b.list, false);
    r.add(
      alert({ kind: 'indicator', rule: 'ema-turn-up', period: 9, ma: 'ema', stdDev: 3, level: 25 }),
    );
    const out: string[] = [];
    // depois da queda (último fechamento 92,5), três altas seguidas: a MME vira na primeira
    [94, 95, 96].forEach((close, j) => {
      const k = {
        time: T0 + (b.n + j) * DAY,
        open: close - 0.5,
        high: close + 0.5,
        low: close - 1,
        close,
        volume: 1,
      };
      out.push(...r.update(k, true).map((h) => h.text));
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('MME virou para cima');
  });

  it('ADX acima do nível: dispara uma vez ao passar de baixo para cima (borda)', () => {
    // 40 candles de lado (ADX baixo) e depois 30 de alta forte
    const b = new Bars();
    // máximas e mínimas alternando: +DM e −DM se equilibram → ADX baixo
    for (let i = 0; i < 40; i++) b.add(100, i % 2 ? 102 : 101, i % 2 ? 99 : 98, 100);
    b.trend(30, 1.5, { range: 0.6 });
    const r = rt();
    r.warmup(b.list.slice(0, 40), false);
    r.add(
      alert({ kind: 'indicator', rule: 'adx-above', period: 14, ma: 'ema', stdDev: 3, level: 25 }),
    );
    const hits = b.list.slice(40).flatMap((k) => r.update(k, true));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toMatch(/ADX \d+,\d \(nível 25\)/);
  });
});

describe('alerta de setup', () => {
  it('dispara os mesmos eventos do motor de setups, com anti-duplicação por ocorrência', () => {
    // série com 9.1: queda e virada da MME9
    const b = new Bars().trend(60, 0.4).trend(8, -0.6).trend(10, 0.7);
    const all = detectSetups(b.list, { only: ['s91'] });
    const armed = all.filter((e) => e.setup === 's91' && e.state === 'armado' && e.index >= 40);
    expect(armed.length).toBeGreaterThan(0);
    const r = rt();
    r.warmup(b.list.slice(0, 40), false);
    r.add(alert({ kind: 'setup', setups: ['s91'], states: ['armado'], sides: ['buy'] }));
    const hits = b.list.slice(40).flatMap((k) => r.update(k, true));
    expect(hits.map((h) => h.candleTime)).toEqual(armed.map((e) => e.time));
    expect(new Set(hits.map((h) => h.dedup)).size).toBe(hits.length);
    expect(hits[0]!.text).toContain('Setup 9.1');
  });
});
