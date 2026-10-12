import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
