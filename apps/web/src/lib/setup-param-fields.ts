import {
  DEFAULT_SETUP_PARAMS,
  SETUP_LABEL,
  setupParamsSchema,
  type SetupParams,
} from '@radar/core';
import type { LibrarySlug } from '../library/catalog';

/**
 * Campos do editor de parâmetros dos setups (SPEC §8: "tudo é editável na interface"). Rótulos
 * escritos à mão em português simples; o teste garante que todo parâmetro do schema tem campo aqui.
 * Limites vêm do schema (packages/core/src/setups/params.ts) — se mudar lá, o teste avisa.
 */
interface Base {
  /** Caminho dentro do grupo, ex.: 'exit.targetR'. */
  path: string;
  label: string;
  help?: string;
  /** Só faz sentido quando outro campo do grupo tem este valor. */
  when?: { path: string; equals: unknown };
}
export type ParamField =
  | (Base & { kind: 'bool' })
  | (Base & { kind: 'enum'; options: { value: string; label: string }[] })
  | (Base & {
      kind: 'number';
      min: number;
      max: number;
      step: number;
      int?: boolean;
      /** Guardado como fração (0,2), mostrado como porcentagem (20%). */
      pct?: boolean;
    });

export type GroupKey = keyof SetupParams;
export interface ParamGroup {
  key: GroupKey;
  title: string;
  desc: string;
  /** Página da Biblioteca com a regra completa. */
  slug?: LibrarySlug;
  fields: ParamField[];
}

const enabled: ParamField = {
  path: 'enabled',
  kind: 'bool',
  label: 'Ligado no gráfico, alertas e scanner',
  help: 'No laboratório quem escolhe os setups são as caixinhas de lá.',
};
const exitFields: ParamField[] = [
  {
    path: 'exit.mode',
    kind: 'enum',
    label: 'Saída',
    options: [
      { value: 'fixed', label: 'Alvo fixo em R' },
      { value: 'dynamic', label: 'Condução, sem alvo (stop acompanha)' },
    ],
  },
  {
    path: 'exit.targetR',
    kind: 'number',
    min: 0.5,
    max: 10,
    step: 0.5,
    label: 'Alvo (em R)',
    help: 'R = distância entre a entrada e o stop. Alvo 2 = ganhar o dobro do que arrisca.',
    when: { path: 'exit.mode', equals: 'fixed' },
  },
];
const allowSell = (help?: string): ParamField => ({
  path: 'allowSell',
  kind: 'bool',
  label: 'Também apostar na queda (venda espelhada)',
  ...(help ? { help } : {}),
});

export const PARAM_GROUPS: readonly ParamGroup[] = [
  {
    key: 's91',
    title: SETUP_LABEL.s91,
    desc: 'Virada da MME9 para cima.',
    slug: 'setup-9-1',
    fields: [
      enabled,
      { path: 'trendFilter', kind: 'bool', label: 'Só comprar com a MMA50 subindo' },
      {
        path: 'lateralFilter',
        kind: 'bool',
        label: 'Não operar em mercado lateral',
        help: 'Lateral = ADX abaixo do mínimo ou MMA50 plana.',
      },
      {
        path: 'adxMin',
        kind: 'number',
        min: 0,
        max: 60,
        step: 1,
        label: 'ADX mínimo (abaixo disso é lateral)',
        when: { path: 'lateralFilter', equals: true },
      },
      {
        path: 'stopMode',
        kind: 'enum',
        label: 'Stop',
        options: [
          { value: 'signal-low', label: 'Na mínima do candle de sinal' },
          { value: 'prior-swing', label: 'No último fundo' },
        ],
      },
      ...exitFields,
      {
        path: 'trailTrigger',
        kind: 'bool',
        label: 'Se não romper, o gatilho desce para a máxima do novo candle',
        help: 'Decisão nossa (o vídeo não diz). Só enquanto a MME9 segue subindo.',
      },
      allowSell('Não está descrito nos vídeos.'),
    ],
  },
  {
    key: 's92',
    title: SETUP_LABEL.s92,
    desc: 'Com a MME9 subindo, um candle fecha abaixo da mínima do candle de referência.',
    slug: 'setup-9-2',
    fields: [enabled, ...exitFields, allowSell()],
  },
  {
    key: 's93',
    title: SETUP_LABEL.s93,
    desc: 'Com a MME9 subindo, dois fechamentos abaixo do fechamento de referência.',
    slug: 'setup-9-3',
    fields: [
      enabled,
      {
        path: 'consecutive',
        kind: 'bool',
        label: 'Os dois fechamentos precisam ser seguidos',
        help: 'O vídeo não deixa claro; padrão nosso: sim.',
      },
      ...exitFields,
      allowSell(),
    ],
  },
  {
    key: 'pullback',
    title: SETUP_LABEL.pullback,
    desc: 'Recuo até a média que o ativo respeita, seguido de retomada.',
    slug: 'recuo-a-media',
    fields: [
      enabled,
      {
        path: 'ma',
        kind: 'enum',
        label: 'Média do recuo',
        options: [
          { value: 'auto', label: 'A que o ativo respeita (automático)' },
          { value: 'ema9', label: 'MME9' },
          { value: 'ema21', label: 'MME21' },
          { value: 'sma50', label: 'MMA50' },
        ],
      },
      {
        path: 'nearAtr',
        kind: 'number',
        min: 0,
        max: 3,
        step: 0.05,
        label: '"Perto da média": mínima até k × ATR da média',
      },
      {
        path: 'requireHealthy',
        kind: 'bool',
        label: 'Exigir recuo saudável',
        help: 'Candles do recuo menores que os do impulso. O experimento E4 compara com e sem.',
      },
      {
        path: 'smallerRangeRatio',
        kind: 'number',
        min: 0.1,
        max: 2,
        step: 0.05,
        label: 'Recuo saudável: tamanho dos candles até k × os do impulso',
        when: { path: 'requireHealthy', equals: true },
      },
      {
        path: 'stopMode',
        kind: 'enum',
        label: 'Stop',
        options: [
          { value: 'pullback-low', label: 'Na mínima do recuo' },
          { value: 'trigger-low', label: 'Na mínima do candle de gatilho' },
        ],
      },
      ...exitFields,
      {
        path: 'expiryBars',
        kind: 'number',
        min: 1,
        max: 20,
        step: 1,
        int: true,
        label: 'Validade depois de armar (candles)',
      },
      {
        path: 'radarExpiryBars',
        kind: 'number',
        min: 1,
        max: 100,
        step: 1,
        int: true,
        label: 'Validade no radar sem armar (candles)',
      },
    ],
  },
  {
    key: 'consolidation',
    title: SETUP_LABEL.consolidation,
    desc: 'Caixa estreita com Bollinger contraída e rompimento com força.',
    slug: 'rompimento-consolidacao',
    fields: [
      enabled,
      {
        path: 'minBars',
        kind: 'number',
        min: 3,
        max: 100,
        step: 1,
        int: true,
        label: 'Caixa: mínimo de candles',
      },
      {
        path: 'maxBars',
        kind: 'number',
        min: 5,
        max: 200,
        step: 1,
        int: true,
        label: 'Caixa: máximo de candles',
      },
      {
        path: 'maxRangeAtr',
        kind: 'number',
        min: 0.5,
        max: 10,
        step: 0.1,
        label: 'Altura máxima da caixa (× ATR)',
      },
      {
        path: 'squeezeLookback',
        kind: 'number',
        min: 20,
        max: 500,
        step: 1,
        int: true,
        label: 'Contração: comparar com os últimos N candles',
      },
      {
        path: 'squeezeQuantile',
        kind: 'number',
        min: 0.05,
        max: 0.5,
        step: 0.01,
        pct: true,
        label: 'Contração: Bollinger entre as x% mais estreitas',
      },
      {
        path: 'requireVolume',
        kind: 'bool',
        label: 'Exigir volume no rompimento',
        help: 'O experimento E5 compara com e sem.',
      },
      {
        path: 'breakoutVolMult',
        kind: 'number',
        min: 0,
        max: 5,
        step: 0.1,
        label: 'Volume do rompimento ≥ k × a média',
        when: { path: 'requireVolume', equals: true },
      },
      {
        path: 'breakoutBodyMult',
        kind: 'number',
        min: 0,
        max: 5,
        step: 0.1,
        label: 'Corpo do candle de rompimento ≥ k × o corpo médio',
      },
      {
        path: 'entry',
        kind: 'enum',
        label: 'Entrada',
        options: [
          { value: 'breakout', label: 'No rompimento' },
          { value: 'retest', label: 'No reteste do topo rompido' },
        ],
      },
      {
        path: 'retestAtr',
        kind: 'number',
        min: 0,
        max: 3,
        step: 0.05,
        label: 'Reteste: pode voltar até k × ATR abaixo do topo',
        when: { path: 'entry', equals: 'retest' },
      },
      {
        path: 'retestExpiryBars',
        kind: 'number',
        min: 1,
        max: 50,
        step: 1,
        int: true,
        label: 'Reteste: esperar até N candles',
        when: { path: 'entry', equals: 'retest' },
      },
      {
        path: 'stopMode',
        kind: 'enum',
        label: 'Stop',
        options: [
          { value: 'box-low', label: 'No fundo da caixa' },
          { value: 'breakout-low', label: 'Na mínima do candle de rompimento' },
        ],
      },
      ...exitFields,
    ],
  },
  {
    key: 'elastic',
    title: SETUP_LABEL.elastic,
    desc: 'Fechamento fora da Bollinger de 3 desvios e volta para dentro. Alvo: a média central.',
    slug: 'elastico',
    fields: [
      enabled,
      {
        path: 'bbPeriod',
        kind: 'number',
        min: 5,
        max: 100,
        step: 1,
        int: true,
        label: 'Bollinger: período',
        help: 'A definição do setup é 20; mude só para estudo.',
      },
      {
        path: 'bbStdDev',
        kind: 'number',
        min: 1,
        max: 5,
        step: 0.1,
        label: 'Bollinger: desvios',
        help: 'A definição do setup é 3; mude só para estudo.',
      },
      {
        path: 'expiryBars',
        kind: 'number',
        min: 1,
        max: 20,
        step: 1,
        int: true,
        label: 'Expira em N candles sem acionar',
      },
      {
        path: 'requireConfirmation',
        kind: 'bool',
        label: 'Exigir martelo ou candle de força para armar',
      },
      {
        path: 'stopMode',
        kind: 'enum',
        label: 'Stop',
        options: [
          { value: 'outside-bar', label: 'Além do candle que fechou fora' },
          { value: 'extreme-since', label: 'Além do extremo desde o radar' },
        ],
      },
      { path: 'partialAt1R', kind: 'bool', label: 'Realizar metade da posição em 1R' },
      allowSell('Pela banda de cima.'),
    ],
  },
  {
    key: 'reflexivity',
    title: SETUP_LABEL.reflexivity,
    desc: 'Queda forte com lucro crescendo; compra quando as médias semanais viram.',
    slug: 'reflexividade',
    fields: [
      enabled,
      {
        path: 'minDrawdown',
        kind: 'number',
        min: 0.1,
        max: 0.95,
        step: 0.01,
        pct: true,
        label: 'Queda mínima desde o topo',
      },
      {
        path: 'peak',
        kind: 'enum',
        label: 'Topo de referência',
        options: [
          { value: '52w', label: 'Máxima de 52 semanas' },
          { value: 'all', label: 'Máxima histórica' },
        ],
      },
      {
        path: 'minEpsGrowth',
        kind: 'number',
        min: 0,
        max: 2,
        step: 0.01,
        pct: true,
        label: 'Crescimento mínimo do lucro por ação (ao ano)',
        help: 'Só vale quando há dados de balanço. O Radar ainda não tem essa fonte: o sinal sai como "fundamentos NÃO verificados".',
      },
      { path: 'weeklyOnly', kind: 'bool', label: 'Só no gráfico semanal' },
      {
        path: 'confirmBars',
        kind: 'number',
        min: 1,
        max: 50,
        step: 1,
        int: true,
        label: 'Confirmação: até N candles entre o fundo e as médias virarem',
      },
      {
        path: 'radarExpiryBars',
        kind: 'number',
        min: 4,
        max: 520,
        step: 1,
        int: true,
        label: 'Validade do radar (candles)',
      },
      ...exitFields,
    ],
  },
  {
    key: 'pa',
    title: 'Avançado: leitura dos candles',
    desc: 'Definições usadas por todos os setups (topos e fundos, candle de força, volume…).',
    slug: 'primitivas-price-action',
    fields: [
      {
        path: 'pivotN',
        kind: 'number',
        min: 1,
        max: 10,
        step: 1,
        int: true,
        label: 'Topo/fundo: candles de cada lado para confirmar',
        help: 'Maior = topos mais confiáveis, mas confirmados mais tarde.',
      },
      {
        path: 'slopeLookback',
        kind: 'number',
        min: 1,
        max: 50,
        step: 1,
        int: true,
        label: 'Inclinação da média: comparar com N candles atrás',
      },
      {
        path: 'flatSlope',
        kind: 'number',
        min: 0,
        max: 2,
        step: 0.01,
        label: 'Média plana: inclinação abaixo de (em ATR)',
      },
      {
        path: 'steepSlope',
        kind: 'number',
        min: 0,
        max: 10,
        step: 0.1,
        label: 'Média acentuada: inclinação acima de (em ATR)',
      },
      {
        path: 'strongBodyMult',
        kind: 'number',
        min: 1,
        max: 5,
        step: 0.1,
        label: 'Candle de força: corpo ≥ k × o corpo médio',
      },
      {
        path: 'ignitionBodyMult',
        kind: 'number',
        min: 1,
        max: 5,
        step: 0.1,
        label: 'Barra de ignição: corpo ≥ k × o corpo médio',
      },
      {
        path: 'ignitionMaxShadow',
        kind: 'number',
        min: 0,
        max: 0.5,
        step: 0.01,
        pct: true,
        label: 'Barra de ignição: sombra contrária até x% do candle',
      },
      {
        path: 'hammerShadowMult',
        kind: 'number',
        min: 1,
        max: 5,
        step: 0.1,
        label: 'Martelo: sombra de baixo ≥ k × o corpo',
      },
      {
        path: 'hammerMaxUpper',
        kind: 'number',
        min: 0,
        max: 0.5,
        step: 0.01,
        pct: true,
        label: 'Martelo: sombra de cima até x% do candle',
      },
      {
        path: 'dojiMaxBody',
        kind: 'number',
        min: 0,
        max: 0.5,
        step: 0.01,
        pct: true,
        label: 'Doji: corpo até x% do candle',
      },
      {
        path: 'volHigh',
        kind: 'number',
        min: 1,
        max: 5,
        step: 0.1,
        label: 'Volume alto: ≥ k × a média de 21',
      },
      {
        path: 'volHuge',
        kind: 'number',
        min: 1,
        max: 10,
        step: 0.1,
        label: 'Volume estrondoso: ≥ k × a média de 21',
      },
      {
        path: 'falseBreakBars',
        kind: 'number',
        min: 1,
        max: 10,
        step: 1,
        int: true,
        label: 'Falso rompimento: volta para dentro em até N candles',
      },
      {
        path: 'breakoutByClose',
        kind: 'bool',
        label: 'Rompimento só vale no fechamento (pavio não conta)',
      },
      {
        path: 'respectNearAtr',
        kind: 'number',
        min: 0,
        max: 3,
        step: 0.05,
        label: 'Média respeitada: mínima até k × ATR da média',
      },
    ],
  },
];

/** Regras entre dois campos que o schema sozinho não garante (senão o setup nunca aparece). */
export const CROSS_CHECKS: readonly {
  group: GroupKey;
  lower: string;
  upper: string;
  message: string;
}[] = [
  {
    group: 'consolidation',
    lower: 'minBars',
    upper: 'maxBars',
    message: 'O mínimo de candles da caixa precisa ser menor que o máximo.',
  },
  {
    group: 'pa',
    lower: 'flatSlope',
    upper: 'steepSlope',
    message: 'A inclinação "plana" precisa ser menor que a "acentuada".',
  },
  {
    group: 'pa',
    lower: 'volHigh',
    upper: 'volHuge',
    message: 'O volume "alto" precisa ser menor ou igual ao "estrondoso".',
  },
];

export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Cópia com o valor trocado no caminho (não altera o original). */
export function setAt<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const src = (obj ?? {}) as Record<string, unknown>;
  if (!head) return obj;
  return {
    ...src,
    [head]: rest.length ? setAt(src[head], rest.join('.'), value) : value,
  } as T;
}

export const defaultOf = (group: GroupKey, path: string): unknown =>
  getAt(DEFAULT_SETUP_PARAMS[group], path);

/** Quais campos estão diferentes do padrão, como "grupo.caminho". */
export function changedPaths(p: SetupParams): string[] {
  const out: string[] = [];
  for (const g of PARAM_GROUPS)
    for (const f of g.fields)
      if (getAt(p[g.key], f.path) !== defaultOf(g.key, f.path)) out.push(`${g.key}.${f.path}`);
  return out;
}

export function crossErrors(p: SetupParams): { group: GroupKey; message: string }[] {
  return CROSS_CHECKS.filter((c) => {
    const lo = getAt(p[c.group], c.lower);
    const hi = getAt(p[c.group], c.upper);
    if (typeof lo !== 'number' || typeof hi !== 'number') return false;
    return c.group === 'pa' && c.lower === 'volHigh' ? lo > hi : lo >= hi;
  }).map((c) => ({ group: c.group, message: c.message }));
}

/**
 * Alterações que importam para um teste do laboratório: só os setups escolhidos e a leitura dos
 * candles. "Ligado" não conta: no laboratório os setups marcados são sempre testados.
 */
export function labChanges(raw: unknown, setups: readonly GroupKey[]): string[] {
  const r = setupParamsSchema.safeParse(raw ?? {});
  if (!r.success) return [];
  const keep = new Set<string>(['pa', ...setups]);
  return changedPaths(r.data).filter((p) => {
    const [g, ...rest] = p.split('.');
    return keep.has(g ?? '') && rest.join('.') !== 'enabled';
  });
}
