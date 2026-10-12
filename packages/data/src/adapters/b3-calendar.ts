import type { Session } from '@radar/shared';

/**
 * Horário e feriados da B3 (ações, mercado à vista).
 *
 * ❌ NÃO VERIFICADO na fonte oficial nesta sessão (ver docs/DATA_SOURCES.md). A B3 muda o horário
 * quando os EUA entram/saem do horário de verão; confira em
 * https://www.b3.com.br/pt_br/solucoes/plataformas/puma-trading-system/para-participantes-e-traders/horario-de-negociacao/
 * e ajuste aqui.
 */
export const B3_HOLIDAYS_2026: readonly string[] = [
  '2026-01-01', // Confraternização Universal
  '2026-02-16', // Carnaval
  '2026-02-17', // Carnaval
  '2026-04-03', // Paixão de Cristo
  '2026-04-21', // Tiradentes
  '2026-05-01', // Dia do Trabalho
  '2026-06-04', // Corpus Christi
  '2026-09-07', // Independência
  '2026-10-12', // Nossa Senhora Aparecida
  '2026-11-02', // Finados
  '2026-11-20', // Consciência Negra
  '2026-12-24', // véspera de Natal (sem pregão)
  '2026-12-25', // Natal
  '2026-12-31', // último dia do ano (sem pregão)
];

export const B3_EQUITY_SESSION: Session = {
  timezone: 'America/Sao_Paulo',
  days: [1, 2, 3, 4, 5],
  preOpen: '09:45',
  open: '10:00',
  close: '17:00',
  holidays: [...B3_HOLIDAYS_2026],
};
