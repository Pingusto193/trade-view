import { z } from 'zod';

/** Escalas (timeframes) suportadas pelo Radar, da menor para a maior. */
export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '60m', '1d', '1w', '1M'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const timeframeSchema = z.enum(TIMEFRAMES);

const MINUTE = 60_000;

/** Duração nominal de cada escala intradiária, em milissegundos. */
export const INTRADAY_MS: Readonly<Record<'1m' | '5m' | '15m' | '30m' | '60m', number>> = {
  '1m': MINUTE,
  '5m': 5 * MINUTE,
  '15m': 15 * MINUTE,
  '30m': 30 * MINUTE,
  '60m': 60 * MINUTE,
};

export function isIntraday(tf: Timeframe): tf is '1m' | '5m' | '15m' | '30m' | '60m' {
  return tf in INTRADAY_MS;
}

/** Rótulos em PT-BR. */
export const TIMEFRAME_LABEL: Readonly<Record<Timeframe, string>> = {
  '1m': '1 min',
  '5m': '5 min',
  '15m': '15 min',
  '30m': '30 min',
  '60m': '60 min',
  '1d': 'Diário',
  '1w': 'Semanal',
  '1M': 'Mensal',
};

export function timeframeRank(tf: Timeframe): number {
  return TIMEFRAMES.indexOf(tf);
}

/** Mapeamentos da "visão fractal" (SPEC §7): contexto, setup e gatilho. */
export interface FractalMapping {
  id: string;
  label: string;
  context: Timeframe;
  setup: Timeframe;
  trigger: Timeframe;
}

export const FRACTAL_MAPPINGS: readonly FractalMapping[] = [
  { id: 'swing-diario', label: 'Operação no diário', context: '1w', setup: '1d', trigger: '60m' },
  {
    id: 'position-semanal',
    label: 'Operação no semanal',
    context: '1M',
    setup: '1w',
    trigger: '1d',
  },
  { id: 'day-15m', label: 'Day trade no 15m', context: '60m', setup: '15m', trigger: '5m' },
];

/** Escala imediatamente maior (para "vento a favor ou contra"). */
export function higherTimeframe(tf: Timeframe): Timeframe | null {
  switch (tf) {
    case '1m':
      return '5m';
    case '5m':
      return '15m';
    case '15m':
      return '60m';
    case '30m':
      return '60m';
    case '60m':
      return '1d';
    case '1d':
      return '1w';
    case '1w':
      return '1M';
    case '1M':
      return null;
  }
}
