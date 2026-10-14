import type { Db } from '../db/client';

/**
 * Exportação e importação completas em JSON (SPEC §17), só dos dados do PRÓPRIO usuário.
 *
 * Fica de fora: conta e senha (users), sessões, tentativas de login, convites, assinaturas de push (presas
 * a cada aparelho), canais de notificação (tokens criptografados com a chave DESTE servidor) e caches
 * de mercado. Tabelas novas com `user_id` entram sozinhas; filhas sem `user_id` precisam estar em CHILD.
 */
export const EXPORT_FORMAT = 'radar-export';
export const EXPORT_VERSION = 1;

const SKIP = new Set([
  'users',
  'sessions',
  'login_attempts',
  'invites',
  'push_subscriptions',
  'notify_settings',
  'candles',
  'series_fetch',
  'macro_series',
  '__drizzle_migrations',
]);

/** Tabelas sem `user_id`, ligadas a uma tabela do usuário. */
const CHILD: Record<string, { fk: string; parent: string }> = {
  watchlist_items: { fk: 'watchlist_id', parent: 'watchlists' },
  paper_orders: { fk: 'account_id', parent: 'paper_accounts' },
  paper_events: { fk: 'account_id', parent: 'paper_accounts' },
  real_fills: { fk: 'trade_id', parent: 'real_trades' },
  real_events: { fk: 'trade_id', parent: 'real_trades' },
};

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: number;
  tables: Record<string, Record<string, unknown>[]>;
}

export class ImportError extends Error {}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

function columns(db: Db, table: string): string[] {
  return (db.$client.prepare(`PRAGMA table_info(${q(table)})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

/** Tabelas do usuário, pais antes dos filhos (ordem de inserção). */
function userTables(db: Db): { name: string; kind: 'user' | 'child' }[] {
  const all = (
    db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((t) => t.name);
  const direct = all
    .filter((t) => !SKIP.has(t) && !CHILD[t] && columns(db, t).includes('user_id'))
    .sort();
  const children = all.filter((t) => CHILD[t]).sort();
  return [
    ...direct.map((name) => ({ name, kind: 'user' as const })),
    ...children.map((name) => ({ name, kind: 'child' as const })),
  ];
}

export function exportUser(db: Db, userId: number, now = Date.now()): ExportFile {
  const tables: ExportFile['tables'] = {};
  for (const t of userTables(db)) {
    if (t.kind === 'user') {
      tables[t.name] = db.$client
        .prepare(`SELECT * FROM ${q(t.name)} WHERE user_id = ?`)
        .all(userId) as Record<string, unknown>[];
    } else {
      const c = CHILD[t.name] as { fk: string; parent: string };
      tables[t.name] = db.$client
        .prepare(
          `SELECT * FROM ${q(t.name)} WHERE ${q(c.fk)} IN (SELECT id FROM ${q(c.parent)} WHERE user_id = ?)`,
        )
        .all(userId) as Record<string, unknown>[];
    }
  }
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now, tables };
}

/**
 * Substitui TODOS os dados do usuário pelos do arquivo, numa transação (falhou = nada muda). Colunas
 * que não existem mais são ignoradas; as novas ficam com o padrão do banco.
 */
export function importUser(db: Db, userId: number, file: unknown): { rows: number } {
  const f = file as Partial<ExportFile> | null;
  if (!f || f.format !== EXPORT_FORMAT || typeof f.tables !== 'object' || f.tables === null)
    throw new ImportError('Arquivo não é uma exportação do Radar.');
  if (f.version !== EXPORT_VERSION)
    throw new ImportError(`Versão de exportação ${String(f.version)} não suportada.`);
  const tables = userTables(db);
  const known = new Set(tables.map((t) => t.name));
  for (const name of Object.keys(f.tables))
    if (!known.has(name)) throw new ImportError(`Tabela desconhecida no arquivo: ${name}.`);
  let rows = 0;
  const run = db.$client.transaction(() => {
    // apaga do filho para o pai (mesmo sem depender do ON DELETE CASCADE)
    for (const t of [...tables].reverse()) {
      if (t.kind === 'child') {
        const c = CHILD[t.name] as { fk: string; parent: string };
        db.$client
          .prepare(
            `DELETE FROM ${q(t.name)} WHERE ${q(c.fk)} IN (SELECT id FROM ${q(c.parent)} WHERE user_id = ?)`,
          )
          .run(userId);
      } else db.$client.prepare(`DELETE FROM ${q(t.name)} WHERE user_id = ?`).run(userId);
    }
    for (const t of tables) {
      const list = f.tables?.[t.name];
      if (!list) continue;
      if (!Array.isArray(list)) throw new ImportError(`Tabela ${t.name} inválida no arquivo.`);
      const cols = new Set(columns(db, t.name));
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') throw new ImportError(`Linha inválida em ${t.name}.`);
        const row = { ...(raw as Record<string, unknown>) };
        if (t.kind === 'user') row.user_id = userId; // o dono passa a ser quem importa
        const keys = Object.keys(row).filter((k) => cols.has(k));
        db.$client
          .prepare(
            `INSERT INTO ${q(t.name)} (${keys.map(q).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
          )
          .run(...keys.map((k) => row[k] as never));
        rows++;
      }
    }
  });
  try {
    run();
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(
      `Importação desfeita (nada mudou): ${(e as Error).message}. Se o arquivo veio de outro servidor com outros usuários, importe num servidor novo.`,
    );
  }
  return { rows };
}
