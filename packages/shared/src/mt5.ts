import { z } from 'zod';

/**
 * Protocolo do agente MetaTrader 5 (`agents/mt5-bridge`, ADR-0023).
 *
 * O agente roda no Windows do usuário, lê candles do MT5 (só leitura, nunca envia ordens) e faz
 * `POST /api/mt5/ingest` com `Authorization: Bearer <token>` — conexão de SAÍDA, sem abrir portas no PC.
 * A resposta diz o que o Radar quer acompanhar (`wants`) e quais históricos faltam (`history`).
 *
 * Os horários vão CRUS, como o MT5 entrega (segundos no relógio do servidor da corretora, que pode não
 * ser UTC — DATA_SOURCES §16); o servidor converte para UTC com o fuso informado em `agent`.
 */
export const MT5_PROTOCOL = 1;

/** Escalas que o agente lê direto do MT5 (semanal e mensal são montados no Radar a partir do diário). */
export const MT5_TIMEFRAMES = ['1m', '5m', '15m', '30m', '60m', '1d'] as const;
export type Mt5Timeframe = (typeof MT5_TIMEFRAMES)[number];
export const mt5TimeframeSchema = z.enum(MT5_TIMEFRAMES);

/** Maior histórico pedido de uma vez, por escala (barras). */
export const MT5_MAX_HISTORY = 10_000;

/**
 * Nome de ativo do MT5. Aceita os formatos comuns das corretoras (WIN$N, EURUSD.a, #AAPL, US500.cash),
 * mas não espaços, vírgulas nem ':' (usados nos ids do Radar e nas listas).
 */
export const mt5SymbolNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9._$#@&+!-]{1,40}$/, 'nome de ativo do MT5 inválido');

/** Mercado do ativo: 'auto' deixa o servidor deduzir pelo modo de cálculo e pela moeda. */
export const MT5_MARKETS = ['auto', 'b3', 'forex'] as const;
export const mt5MarketSchema = z.enum(MT5_MARKETS);

/**
 * Campos crus de `symbol_info()` (mesmos nomes do pacote oficial `MetaTrader5`). Valores ausentes ou
 * zerados são tratados no servidor (ex.: `trade_tick_size` = 0 → usa `point`).
 */
export const mt5SymbolInfoSchema = z.object({
  name: mt5SymbolNameSchema,
  description: z.string().max(200).default(''),
  path: z.string().max(200).default(''),
  exchange: z.string().max(60).default(''),
  currency_base: z.string().max(12).default(''),
  currency_profit: z.string().max(12).default(''),
  digits: z.number().int().min(0).max(10),
  point: z.number().positive().finite(),
  trade_tick_size: z.number().nonnegative().finite().default(0),
  trade_tick_value: z.number().nonnegative().finite().default(0),
  trade_contract_size: z.number().nonnegative().finite().default(0),
  volume_min: z.number().nonnegative().finite().default(0),
  volume_step: z.number().nonnegative().finite().default(0),
  trade_calc_mode: z.number().int().default(-1),
  /** Mercado escolhido na configuração do agente para este ativo. */
  market: mt5MarketSchema.default('auto'),
});
export type Mt5SymbolInfo = z.infer<typeof mt5SymbolInfoSchema>;

/**
 * Uma barra crua do MT5: [time (s, relógio do servidor da corretora), open, high, low, close,
 * tick_volume, spread, real_volume].
 */
export const mt5RateSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().nonnegative().finite(),
  z.number().finite(),
  z.number().nonnegative().finite(),
]);
export type Mt5Rate = z.infer<typeof mt5RateSchema>;

/**
 * Modo do agente:
 * - `mt5`: dados reais do terminal;
 * - `simulated`: simulador do agente (DADOS SIMULADOS; o servidor só aceita em desenvolvimento);
 * - `check`: teste de conexão, sem dados.
 */
export const MT5_AGENT_MODES = ['mt5', 'simulated', 'check'] as const;
export type Mt5AgentMode = (typeof MT5_AGENT_MODES)[number];

export const mt5IngestSchema = z.object({
  protocol: z.literal(MT5_PROTOCOL),
  agent: z.object({
    version: z.string().max(20),
    mode: z.enum(MT5_AGENT_MODES),
    /** O terminal está aberto e conectado à corretora? */
    terminalConnected: z.boolean(),
    /** Nome da corretora (`terminal_info().company`). */
    company: z.string().max(120).optional(),
    /**
     * Fuso do servidor da corretora configurado no agente: 'auto', 'NY+7' (fechamento de Nova York),
     * 'UTC', 'UTC+02:00', 'UTC-3' ou um nome IANA (ex.: 'America/Sao_Paulo').
     */
    serverTz: z.string().max(60).default('auto'),
    /** Diferença (min) entre o relógio do servidor e o UTC, medida com ticks recentes; null = sem medida. */
    detectedOffsetMin: z.number().int().min(-720).max(840).nullable().default(null),
  }),
  /** Ativos oferecidos por este agente (mandados no 1º contato e de tempos em tempos). */
  symbols: z.array(mt5SymbolInfoSchema).max(200).optional(),
  bars: z
    .array(
      z.object({
        symbol: mt5SymbolNameSchema,
        tf: mt5TimeframeSchema,
        /** Da mais antiga para a mais nova; a última é a barra em formação. */
        rates: z.array(mt5RateSchema).max(MT5_MAX_HISTORY),
        /** true = resposta a um pedido de histórico. */
        history: z.boolean().default(false),
      }),
    )
    .max(400)
    .default([]),
  /** Problemas vistos no PC (ex.: ativo inexistente na corretora), mostrados na tela Fontes de dados. */
  errors: z
    .array(z.object({ symbol: z.string().max(40).optional(), message: z.string().max(300) }))
    .max(50)
    .default([]),
});
export type Mt5Ingest = z.infer<typeof mt5IngestSchema>;
export type Mt5IngestInput = z.input<typeof mt5IngestSchema>;

export interface Mt5IngestResponse {
  ok: true;
  serverTime: number;
  /** (ativo, escala) acompanhados agora pelo Radar: mande as últimas barras a cada ciclo. */
  wants: { symbol: string; tf: Mt5Timeframe }[];
  /** Históricos que faltam: mande `count` barras de cada um. */
  history: { symbol: string; tf: Mt5Timeframe; count: number }[];
  /** Avisos para o console do agente. */
  messages: string[];
}

/** Estado de um agente (um token), para a tela Fontes de dados. */
export interface Mt5AgentStatus {
  id: number;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  /** Mandou dados nos últimos segundos? */
  online: boolean;
  mode: Mt5AgentMode | null;
  version: string | null;
  company: string | null;
  terminalConnected: boolean | null;
  symbols: string[];
  /** Fuso usado para converter os horários (ex.: "UTC+3 detectado pelos ticks"). */
  clock: string | null;
  notes: string[];
  errors: string[];
}
