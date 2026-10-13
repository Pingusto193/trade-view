import type { Candle } from '@radar/shared';
import { AGAINST_HIGHER_WARNING } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETUP_PARAMS,
  FEEDBACK_AFTER_BARS,
  FEEDBACK_MAX_CANDLES,
  FEEDBACK_WARMUP_BARS,
  feedbackCandleLimit,
  tradeFeedback,
  type FeedbackInput,
  type FeedbackKey,
  type FeedbackPlan,
  type FeedbackTrade,
  type TradeFeedback,
} from '../src';
import { Bars, DAY, T0, params } from './setups/helpers';

const HOUR = 3_600_000;
/** Meio do candle diário de índice `idx` (instante dentro do candle). */
const at = (idx: number, hours = 12) => T0 + idx * DAY + hours * HOUR;

/**
 * Alta de 70 candles; o candle 70 fecha abaixo da mínima do anterior com a MME9 subindo: arma o
 * Setup 9.2 (gatilho 170,21; stop 167,49). O 71 rompe o gatilho e a alta segue até o alvo de 2R
 * (175,65) do setup, atingido no candle 75.
 */
function fixture92(): Bars {
  const b = new Bars().trend(70, 1, { range: 1 });
  const refLow = b.last.low;
  b.add(b.last.close, b.last.close + 0.2, refLow - 1, refLow - 0.5); // 70: arma
  b.add(b.last.close, 171.21, 167.8, 171.01); // 71: rompe o gatilho
  for (let i = 0; i < 12; i++) b.to(b.last.close + 1.2, { range: 0.8 }); // 72…83: até o alvo
  return b;
}

const PLAN: FeedbackPlan = {
  setup: 's92',
  tfSetup: '1d',
  aligned: true,
  warnings: [],
  released: true,
  missing: [],
};

const TRADE: FeedbackTrade = {
  openedAt: at(71),
  closedAt: at(73),
  entryPrice: 170.25,
  initialStop: 167.49,
  stopAtExit: 167.49,
  target: 175.65,
  exitPrice: 172,
  exitKind: 'manual',
  r: 0.6,
  riskPct: 0.5,
  stopMovedBack: false,
};

function input(
  candles: readonly Candle[] | null,
  over: Partial<Omit<FeedbackInput, 'trade'>> & { trade?: Partial<FeedbackTrade> } = {},
): FeedbackInput {
  const { trade, ...rest } = over;
  return {
    candles,
    tf: '1d',
    tz: 'UTC',
    tick: 0.01,
    params: DEFAULT_SETUP_PARAMS,
    plan: PLAN,
    maxRiskPct: 2,
    ...rest,
    trade: { ...TRADE, ...trade },
  };
}

const item = (fb: TradeFeedback, key: FeedbackKey) => {
  const it = fb.items.find((x) => x.key === key);
  if (!it) throw new Error(`sem item ${key}`);
  return it;
};

describe('feedback do trade — estrutura', () => {
  it('sempre devolve os 7 itens, na ordem, com título e porquê', () => {
    const fb = tradeFeedback(input(fixture92().list));
    expect(fb.items.map((x) => x.key)).toEqual([
      'plano',
      'gatilho',
      'escala',
      'risco',
      'stop',
      'saida',
      'setup-puro',
    ]);
    for (const x of fb.items) {
      expect(x.titulo.length).toBeGreaterThan(5);
      expect(x.detalhe.length).toBeGreaterThan(20);
    }
    expect(fb.tf).toBe('1d');
  });

  it('limite de candles pedido à fonte: aquecimento + trade + depois da saída, com teto', () => {
    const now = T0 + 10 * DAY;
    expect(feedbackCandleLimit('1d', T0, now)).toBe(
      FEEDBACK_WARMUP_BARS + 12 + FEEDBACK_AFTER_BARS,
    );
    expect(feedbackCandleLimit('1w', T0, T0 + 70 * DAY)).toBe(
      FEEDBACK_WARMUP_BARS + 12 + FEEDBACK_AFTER_BARS,
    );
    expect(feedbackCandleLimit('1m', T0, T0 + 30 * DAY)).toBe(FEEDBACK_MAX_CANDLES);
    // relógio atrás da abertura (não deveria acontecer): nunca negativo
    expect(feedbackCandleLimit('1d', now, T0)).toBe(FEEDBACK_WARMUP_BARS + 2 + FEEDBACK_AFTER_BARS);
  });
});

describe('a. plano', () => {
  it('liberado = ok', () => {
    const x = item(tradeFeedback(input(null)), 'plano');
    expect(x.status).toBe('ok');
    expect(x.detalhe).toMatch(/Plano liberado/);
  });

  it('sem plano = atenção', () => {
    const x = item(tradeFeedback(input(null, { plan: null })), 'plano');
    expect(x.status).toBe('atencao');
    expect(x.detalhe).toMatch(/sem plano/);
  });

  it('incompleto lista o que faltou', () => {
    const plan = { ...PLAN, released: false, missing: ['checklist', 'print do gráfico'] };
    const x = item(tradeFeedback(input(null, { plan })), 'plano');
    expect(x.status).toBe('atencao');
    expect(x.detalhe).toBe('Plano incompleto. Faltou: checklist, print do gráfico.');
  });

  it('borda: incompleto sem o registro do que faltava não inventa a lista', () => {
    const plan: FeedbackPlan = { ...PLAN, released: false };
    delete plan.missing;
    const x = item(tradeFeedback(input(null, { plan })), 'plano');
    expect(x.status).toBe('atencao');
    expect(x.detalhe).toMatch(/não ficou registrado/);
  });
});

describe('b. gatilho (mesmo detector, só candles fechados antes da abertura)', () => {
  it('setup armado e entrada além do gatilho = ok, com os números', () => {
    const x = item(tradeFeedback(input(fixture92().list)), 'gatilho');
    expect(x.status).toBe('ok');
    expect(x.detalhe).toMatch(/Setup 9\.2 armado desde 11\/03\/2020 com gatilho em 170,21/);
    expect(x.detalhe).toMatch(/170,25, no gatilho ou além \(0,02% acima\)/);
  });

  it('borda: entrada exatamente no gatilho = ok', () => {
    const fb = tradeFeedback(input(fixture92().list, { trade: { entryPrice: 170.21 } }));
    expect(item(fb, 'gatilho').status).toBe('ok');
    expect(item(fb, 'gatilho').detalhe).not.toMatch(/acima/);
  });

  it('entrada abaixo do gatilho = antecipou (atenção)', () => {
    const x = item(
      tradeFeedback(input(fixture92().list, { trade: { entryPrice: 169 } })),
      'gatilho',
    );
    expect(x.status).toBe('atencao');
    expect(x.detalhe).toMatch(/antecipou/);
    expect(x.detalhe).toMatch(/169,00/);
  });

  it('abrir no próprio candle que arma: o setup ainda não estava armado (sem look-ahead)', () => {
    const x = item(
      tradeFeedback(input(fixture92().list, { trade: { openedAt: at(70) } })),
      'gatilho',
    );
    expect(x.status).toBe('atencao');
    expect(x.detalhe).toMatch(/Não havia Setup 9\.2 armado/);
    expect(x.detalhe).toMatch(/tocou a média/);
  });

  it('setup já acionado num candle anterior: entrou depois, no gatilho ou além = ok', () => {
    const fb = tradeFeedback(
      input(fixture92().list, { trade: { openedAt: at(72), entryPrice: 172.5 } }),
    );
    expect(item(fb, 'gatilho').status).toBe('ok');
    expect(item(fb, 'gatilho').detalhe).toMatch(/já tinha acionado .* a 170,21/);
    const below = tradeFeedback(
      input(fixture92().list, { trade: { openedAt: at(72), entryPrice: 169.9 } }),
    );
    expect(item(below, 'gatilho').status).toBe('atencao');
    expect(item(below, 'gatilho').detalhe).toMatch(/abaixo do gatilho/);
  });

  it('look-ahead: mudar os candles a partir da abertura não muda o item', () => {
    const base = fixture92().list;
    const a = item(tradeFeedback(input(base)), 'gatilho');
    // o candle da abertura e todos os seguintes viram uma queda forte
    const changed = base.map((c, k) =>
      k >= 71 ? { ...c, open: 150, high: 151, low: 120, close: 121, volume: 99_999 } : c,
    );
    expect(item(tradeFeedback(input(changed)), 'gatilho')).toEqual(a);
    // e sem os candles do futuro, também igual
    expect(item(tradeFeedback(input(base.slice(0, 71))), 'gatilho')).toEqual(a);
  });

  it('usa os parâmetros do usuário e roda o setup mesmo se ele estiver desligado', () => {
    const off = params((p) => {
      p.s92.enabled = false;
    });
    expect(item(tradeFeedback(input(fixture92().list, { params: off })), 'gatilho').status).toBe(
      'ok',
    );
  });

  it('borda: leitura própria, plano sem setup e sem plano = sem dados, explicando', () => {
    const manual = item(
      tradeFeedback(input(fixture92().list, { plan: { ...PLAN, setup: 'manual' } })),
      'gatilho',
    );
    expect(manual.status).toBe('sem-dados');
    expect(manual.detalhe).toMatch(/Leitura própria/);
    const blank = item(
      tradeFeedback(input(fixture92().list, { plan: { ...PLAN, setup: '' } })),
      'gatilho',
    );
    expect(blank.status).toBe('sem-dados');
    expect(blank.detalhe).toMatch(/não cita um setup/);
    const none = item(tradeFeedback(input(fixture92().list, { plan: null })), 'gatilho');
    expect(none.status).toBe('sem-dados');
  });

  it('borda: fonte falhou = sem dados com o motivo (nunca inventa)', () => {
    const x = item(
      tradeFeedback(input(null, { candlesError: 'fonte indisponível (timeout)' })),
      'gatilho',
    );
    expect(x.status).toBe('sem-dados');
    expect(x.detalhe).toMatch(/fonte indisponível \(timeout\)/);
    expect(x.detalhe).toMatch(/não inventa/);
  });

  it('borda: poucos candles antes da entrada = sem dados', () => {
    const b = new Bars().trend(40, 1, { range: 1 });
    b.add(b.last.close, b.last.close + 0.2, b.last.low - 1, b.last.low - 0.5);
    b.trend(5, 1);
    const x = item(tradeFeedback(input(b.list, { trade: { openedAt: at(41) } })), 'gatilho');
    expect(x.status).toBe('sem-dados');
    expect(x.detalhe).toMatch(/Só 41 candles diário fechados antes da entrada/);
  });

  it('escala intradiária no fuso da bolsa: o candle de 60 min que contém a abertura fica de fora', () => {
    const H0 = Date.UTC(2026, 0, 5, 0, 0);
    const hourly = fixture92().list.map((c, k) => ({ ...c, time: H0 + k * HOUR }));
    const opts = { tf: '60m' as const, tz: 'America/Sao_Paulo' };
    const inside = tradeFeedback(
      input(hourly, { ...opts, trade: { openedAt: H0 + 71 * HOUR + 20 * 60_000 } }),
    );
    expect(item(inside, 'gatilho').status).toBe('ok');
    expect(item(inside, 'gatilho').detalhe).toMatch(/\(07\/01\/2026 19:00, 60 min\)/);
    const same = tradeFeedback(
      input(hourly, { ...opts, trade: { openedAt: H0 + 70 * HOUR + 59 * 60_000 } }),
    );
    expect(item(same, 'gatilho').detalhe).toMatch(/Não havia/);
  });
});

describe('c. escala maior (resposta do plano × aviso automático gravado)', () => {
  const run = (aligned: boolean, warnings: string[]) =>
    item(tradeFeedback(input(null, { plan: { ...PLAN, aligned, warnings } })), 'escala');

  it('marcou a favor e sem aviso = ok', () => {
    expect(run(true, ['ADX abaixo de 20: mercado lateral.']).status).toBe('ok');
  });

  it('divergência: marcou a favor, mas o aviso vermelho apareceu = atenção', () => {
    const x = run(true, [AGAINST_HIGHER_WARNING]);
    expect(x.status).toBe('atencao');
    expect(x.detalhe).toMatch(/Você marcou as escalas a favor, mas o aviso automático/);
  });

  it('entrou contra sabendo = atenção; marcou "não alinhado" sem aviso = atenção', () => {
    expect(run(false, [AGAINST_HIGHER_WARNING]).detalhe).toMatch(/Entrou contra a escala maior/);
    expect(run(false, []).status).toBe('atencao');
  });

  it('borda: aviso do motor ("Aviso vermelho: contra a escala maior") também conta; sem plano = sem dados', () => {
    expect(run(true, ['⚠ Aviso vermelho: contra a escala maior (Semanal em baixa)']).status).toBe(
      'atencao',
    );
    expect(item(tradeFeedback(input(null, { plan: null })), 'escala').status).toBe('sem-dados');
  });
});

describe('d. risco', () => {
  const run = (trade: Partial<FeedbackTrade>) =>
    item(tradeFeedback(input(null, { trade })), 'risco');

  it('dentro do limite = ok, com o número', () => {
    const x = run({ riskPct: 0.5 });
    expect(x.status).toBe('ok');
    expect(x.detalhe).toMatch(/0,50% do patrimônio.*limite de 2,00%/);
  });

  it('borda: exatamente no limite = ok', () => {
    expect(run({ riskPct: 2 }).status).toBe('ok');
  });

  it('acima do limite = atenção', () => {
    const x = run({ riskPct: 3.1 });
    expect(x.status).toBe('atencao');
    expect(x.detalhe).toMatch(/3,10%.*acima do seu limite de 2,00%/);
  });

  it('sem stop = atenção; risco não medido (antes do reinício) = sem dados', () => {
    expect(run({ initialStop: null, riskPct: null }).status).toBe('atencao');
    const x = run({ riskPct: null });
    expect(x.status).toBe('sem-dados');
    expect(x.detalhe).toMatch(/reinício/);
  });
});

describe('e. stop', () => {
  const run = (trade: Partial<FeedbackTrade>) =>
    item(tradeFeedback(input(null, { trade })), 'stop');

  it('com stop e sem afastar = ok', () => {
    const x = run({});
    expect(x.status).toBe('ok');
    expect(x.detalhe).toMatch(/167,49/);
  });

  it('stop movido para trás = atenção', () => {
    const x = run({ stopMovedBack: true });
    expect(x.status).toBe('atencao');
    expect(x.detalhe).toMatch(/movido para trás/);
  });

  it('sem stop = atenção', () => {
    expect(run({ initialStop: null, stopAtExit: null }).status).toBe('atencao');
  });
});

describe('f. saída: realizou cedo? (até 20 candles depois da saída)', () => {
  /** 80 candles parados em 100; a saída é no candle 80 (índice). */
  function flat(
    after: readonly (readonly [number, number, number, number])[],
    exitBar?: Candle,
  ): Candle[] {
    const b = new Bars();
    for (let k = 0; k < 80; k++) b.add(100, 100.5, 99.5, 100);
    if (exitBar) b.list.push({ ...exitBar, time: T0 + 80 * DAY });
    else b.add(103, 104.5, 102.5, 104);
    for (const [o, h, l, c] of after) b.add(o, h, l, c);
    return b.list;
  }
  const trade: Partial<FeedbackTrade> = {
    openedAt: at(78),
    closedAt: at(80),
    entryPrice: 100,
    initialStop: 95,
    stopAtExit: 95,
    target: 110,
    exitPrice: 104,
    exitKind: 'manual',
  };
  const manual = { ...PLAN, setup: 'manual' };
  const run = (candles: Candle[] | null, t: Partial<FeedbackTrade> = {}, lastOpen = false) =>
    item(
      tradeFeedback(input(candles, { plan: manual, lastOpen, trade: { ...trade, ...t } })),
      'saida',
    );
  const still = (n: number) => Array.from({ length: n }, () => [104, 105, 103, 104] as const);

  it('o preço chegou ao alvo antes do stop = realizou cedo (atenção), com o R deixado', () => {
    const x = run(
      flat([
        [104, 106, 103, 105],
        [105, 111, 104, 110],
      ]),
    );
    expect(x.status).toBe('atencao');
    expect(x.detalhe).toMatch(
      /alvo de 110,00 \(23\/03\/2020\) antes do stop de 95,00: realizou cedo/,
    );
    expect(x.detalhe).toMatch(/cerca de 1,20R/);
  });

  it('bateu no stop antes = sair foi bom (ok)', () => {
    const x = run(
      flat([
        [104, 104.5, 96, 97],
        [97, 98, 94, 95],
        [95, 112, 94, 111],
      ]),
    );
    expect(x.status).toBe('ok');
    expect(x.detalhe).toMatch(/bateu no stop de 95,00 .* sair foi bom/);
  });

  it('borda: stop e alvo no mesmo candle = stop primeiro (modelo conservador do backtest)', () => {
    expect(run(flat([[104, 111, 94, 105]])).status).toBe('ok');
  });

  it('borda: gap acima do alvo conta como alvo', () => {
    expect(run(flat([[112, 113, 111, 112]])).status).toBe('atencao');
  });

  it('borda: stop que andou a favor é o que vale depois da saída', () => {
    const x = run(flat([[104, 104.5, 101.5, 102], ...still(3), [104, 111, 103, 110]]), {
      stopAtExit: 102,
    });
    expect(x.status).toBe('ok');
    expect(x.detalhe).toMatch(/stop de 102,00/);
  });

  it('borda: o candle da própria saída não conta (ordem dentro dele é desconhecida)', () => {
    const exitBar = { time: 0, open: 103, high: 111, low: 102, close: 104, volume: 1 };
    expect(run(flat([...still(FEEDBACK_AFTER_BARS)], exitBar)).status).toBe('ok');
  });

  it(`${FEEDBACK_AFTER_BARS} candles sem alvo nem stop = ok; menos que isso = ainda não dá para avaliar`, () => {
    const done = run(flat([...still(FEEDBACK_AFTER_BARS)]));
    expect(done.status).toBe('ok');
    expect(done.detalhe).toMatch(/não chegou ao alvo/);
    const early = run(flat([...still(5)]));
    expect(early.status).toBe('sem-dados');
    expect(early.detalhe).toMatch(/Ainda não dá para avaliar: só 5 de 20/);
    // o alvo no 21º candle não entra
    expect(run(flat([...still(FEEDBACK_AFTER_BARS), [104, 111, 103, 110]])).status).toBe('ok');
  });

  it('borda: candle em formação fica de fora', () => {
    const candles = flat([
      [104, 106, 103, 105],
      [105, 111, 104, 110],
    ]);
    expect(run(candles, {}, true).status).toBe('sem-dados');
  });

  it('saída por stop/alvo = ok; reinício = sem dados; à mão sem lucro = ok', () => {
    expect(run(null, { exitKind: 'stop', exitPrice: 95 }).status).toBe('ok');
    expect(run(null, { exitKind: 'alvo', exitPrice: 110 }).detalhe).toMatch(/alvo planejado/);
    expect(run(null, { exitKind: 'reinicio' }).status).toBe('sem-dados');
    const loss = run(null, { exitPrice: 98 });
    expect(loss.status).toBe('ok');
    expect(loss.detalhe).toMatch(/sem lucro/);
  });

  it('borda: lucro sem alvo planejado ou sem candles = sem dados', () => {
    expect(run(flat([]), { target: null }).detalhe).toMatch(/não havia alvo planejado/);
    const x = item(
      tradeFeedback(input(null, { plan: manual, candlesError: 'sem rede', trade: { ...trade } })),
      'saida',
    );
    expect(x.status).toBe('sem-dados');
    expect(x.detalhe).toMatch(/sem rede/);
  });
});

describe('g. setup puro (a mesma ocorrência, até o fim)', () => {
  it('compara o R real com o R que o detector registrou', () => {
    const fb = tradeFeedback(input(fixture92().list));
    expect(fb.pure).toMatchObject({
      setup: 's92',
      state: 'encerrado',
      exit: 'alvo',
      entered: true,
      realR: 0.6,
    });
    expect(fb.pure?.setupR).toBeCloseTo(2, 6);
    const x = item(fb, 'setup-puro');
    expect(x.status).toBe('atencao');
    expect(x.detalhe).toMatch(
      /Seu trade: \+0,60R\. Setup puro \(Setup 9\.2\): \+2,00R \(saída: alvo/,
    );
    expect(x.detalhe).toMatch(/não tem custos/);
  });

  it('igual ou melhor (com folga para custos) = ok', () => {
    expect(
      item(tradeFeedback(input(fixture92().list, { trade: { r: 1.95 } })), 'setup-puro').status,
    ).toBe('ok');
    expect(
      item(tradeFeedback(input(fixture92().list, { trade: { r: 2.5 } })), 'setup-puro').status,
    ).toBe('ok');
  });

  it('ocorrência ainda aberta = sem dados', () => {
    const fb = tradeFeedback(input(fixture92().list.slice(0, 74)));
    expect(fb.pure).toMatchObject({ state: 'aberto', setupR: null });
    expect(item(fb, 'setup-puro').status).toBe('sem-dados');
    expect(item(fb, 'setup-puro').detalhe).toMatch(/em andamento/);
  });

  it('o setup puro não entrou (desarmou) = 0R', () => {
    const b = new Bars().trend(70, 1, { range: 1 });
    b.add(b.last.close, b.last.close + 0.2, b.last.low - 1, b.last.low - 0.5); // 70: arma
    for (let k = 0; k < 6; k++)
      b.add(b.last.close, b.last.close + 0.1, b.last.close - 3.2, b.last.close - 3); // cai sem romper
    const fb = tradeFeedback(
      input(b.list, { trade: { entryPrice: 168, initialStop: 165, r: -1, closedAt: at(74) } }),
    );
    expect(item(fb, 'gatilho').status).toBe('atencao'); // entrou abaixo do gatilho
    expect(fb.pure).toMatchObject({
      state: 'encerrado',
      entered: false,
      setupR: 0,
      exit: 'desarme',
    });
    const x = item(fb, 'setup-puro');
    expect(x.status).toBe('atencao');
    expect(x.detalhe).toMatch(/0R \(não chegou a entrar: desarmado/);
  });

  it('borda: sem ocorrência, sem R ou sem plano = sem dados', () => {
    const none = tradeFeedback(input(fixture92().list, { trade: { openedAt: at(70) } }));
    expect(none.pure).toBeNull();
    expect(item(none, 'setup-puro').status).toBe('sem-dados');
    const noR = tradeFeedback(input(fixture92().list, { trade: { r: null } }));
    expect(item(noR, 'setup-puro').status).toBe('sem-dados');
    expect(item(noR, 'setup-puro').detalhe).toMatch(/não tem R/);
    expect(item(tradeFeedback(input(null, { plan: null })), 'setup-puro').status).toBe('sem-dados');
  });
});
