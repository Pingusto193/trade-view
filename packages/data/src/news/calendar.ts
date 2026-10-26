import type { AssetTag } from '@radar/shared';

/**
 * Agenda econômica (SPEC §23.1). Copom e FOMC não têm API: as datas oficiais ficam aqui, copiadas das
 * páginas do BCB e do Fed (DATA_SOURCES §19) — revisar todo ano (o Copom publica o calendário em junho).
 * IPCA (IBGE) e payroll/CPI (BLS) entram pelas APIs depois do teste real do formato.
 */
export type EconomicEventKind = 'copom' | 'fomc' | 'ipca' | 'payroll' | 'cpi';

export interface EconomicEvent {
  id: string;
  kind: EconomicEventKind;
  title: string;
  country: 'BR' | 'US';
  /** Horário da divulgação (UTC ms). */
  at: number;
  /** Horário aproximado (ex.: Copom "por volta de 18h30"). */
  approximate: boolean;
  source: string;
  tags: AssetTag[];
}

const COPOM_TAGS: AssetTag[] = [{ type: 'macro', value: 'juros-br' }];
const FOMC_TAGS: AssetTag[] = [{ type: 'macro', value: 'juros-us' }];

// Copom: comunicado por volta das 18h30 de Brasília (UTC−3, sem horário de verão) no 2º dia = 21h30 UTC
const COPOM_DAYS = [
  '2026-11-04',
  '2026-12-09',
  '2027-01-27',
  '2027-03-17',
  '2027-04-28',
  '2027-06-16',
  '2027-08-04',
  '2027-09-22',
  '2027-10-27',
  '2027-12-08',
];
// FOMC: decisão às 14h de Nova York no 2º dia (EDT = 18h UTC; EST = 19h UTC)
const FOMC: [string, number][] = [
  ['2026-10-28', 18],
  ['2026-12-09', 19],
  ['2027-01-27', 19],
  ['2027-03-17', 18],
  ['2027-04-28', 18],
  ['2027-06-09', 18],
  ['2027-07-28', 18],
  ['2027-09-15', 18],
  ['2027-10-27', 18],
  ['2027-12-08', 19],
];

const at = (day: string, hourUtc: number, min = 0) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, hourUtc, min);
};

export const ECONOMIC_CALENDAR: readonly EconomicEvent[] = [
  ...COPOM_DAYS.map((d) => ({
    id: `copom-${d}`,
    kind: 'copom' as const,
    title: 'Copom: decisão da Selic',
    country: 'BR' as const,
    at: at(d, 21, 30),
    approximate: true,
    source: 'https://www.bcb.gov.br/en/monetarypolicy/committee',
    tags: COPOM_TAGS,
  })),
  ...FOMC.map(([d, h]) => ({
    id: `fomc-${d}`,
    kind: 'fomc' as const,
    title: 'FOMC: decisão de juros nos EUA',
    country: 'US' as const,
    at: at(d, h),
    approximate: false,
    source: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    tags: FOMC_TAGS,
  })),
].sort((a, b) => a.at - b.at);

/** Próximos eventos a partir de `now` (e os das últimas `pastMs`). */
export function upcomingEvents(now: number, limit = 10, pastMs = 0): EconomicEvent[] {
  return ECONOMIC_CALENDAR.filter((e) => e.at >= now - pastMs).slice(0, limit);
}
