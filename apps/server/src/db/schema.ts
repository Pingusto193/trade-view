import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Esquema do banco (SQLite). Datas sempre em UTC (ms desde 1970).
 * Novas tabelas entram por migração gerada com `pnpm --filter @radar/server db:generate`.
 */

// ------------------------------------------------------------------ dados de mercado (cache)

export const candles = sqliteTable(
  'candles',
  {
    symbolId: text('symbol_id').notNull(),
    tf: text('tf').notNull(),
    time: integer('time').notNull(),
    open: real('open').notNull(),
    high: real('high').notNull(),
    low: real('low').notNull(),
    close: real('close').notNull(),
    volume: real('volume').notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbolId, t.tf, t.time] })],
);

/** Quando cada série foi buscada na fonte pela última vez (para não estourar cotas). */
export const seriesFetch = sqliteTable(
  'series_fetch',
  {
    symbolId: text('symbol_id').notNull(),
    tf: text('tf').notNull(),
    fetchedAt: integer('fetched_at').notNull(),
    /** Último erro da fonte (texto), se houver. */
    lastError: text('last_error'),
    lastErrorAt: integer('last_error_at'),
  },
  (t) => [primaryKey({ columns: [t.symbolId, t.tf] })],
);

/** Séries macroeconômicas do BCB (CDI, Selic). */
export const macroSeries = sqliteTable(
  'macro_series',
  {
    code: integer('code').notNull(),
    date: integer('date').notNull(),
    value: real('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.code, t.date] })],
);

/**
 * Fundamentos (ADR-0024): valores publicados pela SEC (entity = CIK) e pela CVM (entity = CNPJ só com
 * dígitos), um por documento. Cache longo: fundamentos mudam por trimestre. Nada é apagado; uma
 * reapresentação entra como documento novo, com a sua data de publicação (`filed`).
 */
export const fundamentalFacts = sqliteTable(
  'fundamental_facts',
  {
    /** 'sec' ou 'cvm'. */
    source: text('source').notNull(),
    entity: text('entity').notNull(),
    /** 'eps' (lucro por ação) ou 'revenue' (receita). */
    metric: text('metric').notNull(),
    /** SEC: tag XBRL; CVM: "con|3.99.01.02|PN" (demonstração, conta e rótulo). */
    concept: text('concept').notNull(),
    rank: integer('rank').notNull(),
    start: integer('start').notNull(),
    end: integer('end').notNull(),
    value: real('value').notNull(),
    doc: text('doc').notNull(),
    /** Meia-noite UTC do dia em que ficou público; null = desconhecido (fica fora do laboratório). */
    filed: integer('filed'),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.entity, t.concept, t.start, t.end, t.doc] }),
    index('fundamental_facts_entity_idx').on(t.source, t.entity),
  ],
);

/** Mapas oficiais ticker → empresa (SEC: company_tickers.json; CVM: FCA). */
export const fundamentalTickers = sqliteTable(
  'fundamental_tickers',
  {
    source: text('source').notNull(),
    ticker: text('ticker').notNull(),
    entity: text('entity').notNull(),
    name: text('name'),
    /** Só CVM: ON, PN, PNA… ou UNIT. */
    shareClass: text('share_class'),
  },
  (t) => [primaryKey({ columns: [t.source, t.ticker] })],
);

// ------------------------------------------------------------------ contas e sessões

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  totpSecret: text('totp_secret'),
  totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    /** Hash SHA-256 do token (o token em si só existe no cookie). */
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Tentativas de login (proteção contra força bruta). */
export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull(),
    at: integer('at').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
  },
  (t) => [index('login_attempts_key_idx').on(t.key, t.at)],
);

/** Convites (o cadastro fica fechado após a primeira conta). */
export const invites = sqliteTable('invites', {
  tokenHash: text('token_hash').primaryKey(),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
});

// ------------------------------------------------------------------ preferências, listas e desenhos

/** Preferências por usuário (JSON validado por zod no servidor). */
export const preferences = sqliteTable('preferences', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  json: text('json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const watchlists = sqliteTable(
  'watchlists',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('watchlists_user_idx').on(t.userId)],
);

export const watchlistItems = sqliteTable(
  'watchlist_items',
  {
    watchlistId: integer('watchlist_id')
      .notNull()
      .references(() => watchlists.id, { onDelete: 'cascade' }),
    symbolId: text('symbol_id').notNull(),
    position: integer('position').notNull().default(0),
    addedAt: integer('added_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.watchlistId, t.symbolId] })],
);

export const indicatorPresets = sqliteTable(
  'indicator_presets',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    json: text('json').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('indicator_presets_user_idx').on(t.userId)],
);

/**
 * Desenhos por ativo (SPEC §7). `tf` nulo = visível em todas as escalas.
 * `rev` cresce a cada alteração, para sincronização entre aparelhos.
 */
export const drawings = sqliteTable(
  'drawings',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbolId: text('symbol_id').notNull(),
    tf: text('tf'),
    kind: text('kind').notNull(),
    json: text('json').notNull(),
    locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    rev: integer('rev').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('drawings_user_symbol_idx').on(t.userId, t.symbolId)],
);

// ------------------------------------------------------------------ alertas e notificações (Fase 4)

export const alerts = sqliteTable(
  'alerts',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbolId: text('symbol_id').notNull(),
    tf: text('tf').notNull(),
    /** AlertInput completo (condição, gatilho, canais, repetição) em JSON validado por zod. */
    json: text('json').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastFiredAt: integer('last_fired_at'),
    /** Observação do servidor (ex.: "o desenho foi apagado"). */
    status: text('status'),
  },
  (t) => [index('alerts_user_idx').on(t.userId)],
);

/** Histórico de disparos. `dedupKey` único por usuário garante anti-duplicação. */
export const alertFires = sqliteTable(
  'alert_fires',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    alertId: text('alert_id'),
    dedupKey: text('dedup_key').notNull(),
    symbolId: text('symbol_id').notNull(),
    tf: text('tf').notNull(),
    firedAt: integer('fired_at').notNull(),
    candleTime: integer('candle_time').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    url: text('url').notNull(),
    /** Resultado por canal (JSON). */
    delivery: text('delivery').notNull().default('{}'),
    silenced: integer('silenced', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    uniqueIndex('alert_fires_dedup_idx').on(t.userId, t.dedupKey),
    index('alert_fires_user_time_idx').on(t.userId, t.firedAt),
  ],
);

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    label: text('label').notNull(),
    createdAt: integer('created_at').notNull(),
    lastOkAt: integer('last_ok_at'),
    failCount: integer('fail_count').notNull().default(0),
  },
  (t) => [index('push_user_idx').on(t.userId)],
);

export const notifySettings = sqliteTable('notify_settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  quietEnabled: integer('quiet_enabled', { mode: 'boolean' }).notNull().default(false),
  quietStart: text('quiet_start').notNull().default('22:00'),
  quietEnd: text('quiet_end').notNull().default('07:00'),
  /** Token do bot do Telegram cifrado com o cofre (SecretBox). */
  telegramTokenEnc: text('telegram_token_enc'),
  telegramChatId: text('telegram_chat_id'),
  email: text('email'),
  updatedAt: integer('updated_at').notNull(),
});

// ------------------------------------------------------------------ Modo Treino (dinheiro fictício)

export const paperAccounts = sqliteTable(
  'paper_accounts',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    initialBalance: real('initial_balance').notNull(),
    /** Saldo em R$ (dinheiro fictício). */
    cash: real('cash').notNull(),
    generation: integer('generation').notNull().default(1),
    /** Custos por mercado que substituem os padrões (JSON). */
    costs: text('costs').notNull().default('{}'),
    fxManual: real('fx_manual'),
    createdAt: integer('created_at').notNull(),
    resetAt: integer('reset_at'),
  },
  (t) => [index('paper_accounts_user_idx').on(t.userId)],
);

export const paperOrders = sqliteTable(
  'paper_orders',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => paperAccounts.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull(),
    symbolId: text('symbol_id').notNull(),
    side: text('side').notNull(),
    type: text('type').notNull(),
    qty: real('qty').notNull(),
    price: real('price'),
    stopLoss: real('stop_loss'),
    takeProfit: real('take_profit'),
    status: text('status').notNull(),
    reason: text('reason'),
    note: text('note').notNull().default(''),
    /** Preço de referência quando a ordem foi criada. */
    refPrice: real('ref_price'),
    createdAt: integer('created_at').notNull(),
    filledAt: integer('filled_at'),
    fillPrice: real('fill_price'),
    generation: integer('generation').notNull(),
  },
  (t) => [index('paper_orders_account_idx').on(t.accountId, t.status)],
);

export const paperPositions = sqliteTable(
  'paper_positions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => paperAccounts.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull(),
    symbolId: text('symbol_id').notNull(),
    market: text('market').notNull(),
    currency: text('currency').notNull(),
    pointValue: real('point_value').notNull(),
    tick: real('tick').notNull(),
    qty: real('qty').notNull(),
    /** Quantidade máxima atingida (para o R e a apuração). */
    maxQty: real('max_qty').notNull(),
    avgPrice: real('avg_price').notNull(),
    stop: real('stop'),
    target: real('target'),
    initialStop: real('initial_stop'),
    entryFx: real('entry_fx').notNull(),
    /** Custo de entrada em R$ (para devolver ao saldo e apurar). */
    costBrl: real('cost_brl').notNull(),
    realizedBrl: real('realized_brl').notNull().default(0),
    feesBrl: real('fees_brl').notNull().default(0),
    /** Valor total vendido em R$ (base da isenção do IR). */
    salesBrl: real('sales_brl').notNull().default(0),
    status: text('status').notNull(),
    openedAt: integer('opened_at').notNull(),
    closedAt: integer('closed_at'),
    delayNote: text('delay_note'),
    generation: integer('generation').notNull(),
  },
  (t) => [index('paper_positions_account_idx').on(t.accountId, t.status)],
);

export const paperEvents = sqliteTable(
  'paper_events',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => paperAccounts.id, { onDelete: 'cascade' }),
    time: integer('time').notNull(),
    kind: text('kind').notNull(),
    symbolId: text('symbol_id'),
    positionId: text('position_id'),
    orderId: text('order_id'),
    price: real('price'),
    qty: real('qty'),
    pnlBrl: real('pnl_brl'),
    feesBrl: real('fees_brl'),
    fx: real('fx'),
    detail: text('detail').notNull().default(''),
  },
  (t) => [index('paper_events_account_idx').on(t.accountId, t.time)],
);

/** Planos de trade (SPEC §11) ligados às ordens do treino (e, no futuro, aos trades reais). */
export const tradePlans = sqliteTable(
  'trade_plans',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orderId: text('order_id'),
    positionId: text('position_id'),
    /** Plano sem o print (JSON validado). */
    json: text('json').notNull(),
    released: integer('released', { mode: 'boolean' }).notNull(),
    /** Print do gráfico (data URL JPEG reduzido). */
    screenshot: text('screenshot'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('trade_plans_order_idx').on(t.orderId),
    index('trade_plans_position_idx').on(t.positionId),
  ],
);

/** Execuções do laboratório: tudo fica salvo (registro de tentativas, SPEC §12.3). */
export const labRuns = sqliteTable(
  'lab_runs',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    symbolId: text('symbol_id').notNull(),
    tf: text('tf').notNull(),
    /** Setups ordenados (família de tentativas). */
    setupsKey: text('setups_key').notNull(),
    /** Hash do pedido completo (parâmetros incluídos). */
    configHash: text('config_hash').notNull(),
    result: text('result').notNull(),
  },
  (t) => [
    index('lab_runs_user_idx').on(t.userId, t.createdAt),
    index('lab_runs_family_idx').on(t.userId, t.symbolId, t.setupsKey),
  ],
);

/** Experimentos "Verificar o youtuber" (SPEC §12.4): cada execução guardada inteira. */
export const experimentRuns = sqliteTable(
  'experiment_runs',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    experimentId: text('experiment_id').notNull(),
    createdAt: integer('created_at').notNull(),
    status: text('status', { enum: ['running', 'done', 'error'] }).notNull(),
    run: text('run').notNull(),
  },
  (t) => [index('experiment_runs_user_idx').on(t.userId, t.experimentId, t.createdAt)],
);

/** Varreduras salvas do scanner (SPEC §14): universo + escala + filtros, com agenda opcional. */
export const scans = sqliteTable(
  'scans',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Universo, escala e filtros (JSON validado por zod). */
    config: text('config').notNull(),
    schedule: text('schedule', { enum: ['off', 'daily', 'intraday'] }).notNull(),
    /** Por ativo: último pregão (ou dia UTC) já varrido pela agenda diária. */
    autoState: text('auto_state').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('scans_user_idx').on(t.userId)],
);

/**
 * Último resultado de cada varredura (salva ou avulsa do usuário), com data, fonte e atraso de cada
 * ativo. Chave: "salva:<id>" ou "avulsa:<usuário>".
 */
export const scanResults = sqliteTable(
  'scan_results',
  {
    key: text('key').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scanId: text('scan_id').references(() => scans.id, { onDelete: 'cascade' }),
    running: integer('running', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at').notNull(),
    snapshot: text('snapshot').notNull(),
  },
  (t) => [index('scan_results_user_idx').on(t.userId)],
);

/**
 * Diário de trades REAIS (SPEC §13): o usuário registra o que executou na corretora. O Radar não
 * envia ordens. Resultado, R e IR saem das execuções (`realTrade` do core), nunca guardados à parte.
 */
export const realTrades = sqliteTable(
  'real_trades',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    symbolId: text('symbol_id'),
    market: text('market').notNull(),
    side: text('side', { enum: ['long', 'short'] }).notNull(),
    currency: text('currency').notNull(),
    pointValue: real('point_value').notNull(),
    initialStop: real('initial_stop'),
    stop: real('stop'),
    target: real('target'),
    note: text('note').notNull().default(''),
    /** Plano (JSON, sem o print) e o print em separado (data URL JPEG/PNG). */
    plan: text('plan'),
    screenshot: text('screenshot'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('real_trades_user_idx').on(t.userId, t.createdAt)],
);

export const realFills = sqliteTable(
  'real_fills',
  {
    id: text('id').primaryKey(),
    tradeId: text('trade_id')
      .notNull()
      .references(() => realTrades.id, { onDelete: 'cascade' }),
    time: integer('time').notNull(),
    kind: text('kind', { enum: ['entrada', 'saida'] }).notNull(),
    qty: real('qty').notNull(),
    price: real('price').notNull(),
    feesBrl: real('fees_brl').notNull().default(0),
    fx: real('fx').notNull().default(1),
  },
  (t) => [index('real_fills_trade_idx').on(t.tradeId, t.time)],
);

export const realEvents = sqliteTable(
  'real_events',
  {
    id: text('id').primaryKey(),
    tradeId: text('trade_id')
      .notNull()
      .references(() => realTrades.id, { onDelete: 'cascade' }),
    time: integer('time').notNull(),
    kind: text('kind').notNull(),
    price: real('price'),
    detail: text('detail').notNull().default(''),
  },
  (t) => [index('real_events_trade_idx').on(t.tradeId, t.time)],
);
