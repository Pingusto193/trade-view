import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { runBackup } from '../backup';

/** Backup manual: `pnpm --filter @radar/server backup` (o servidor também faz um por dia sozinho). */
async function main() {
  const dbPath = resolve(process.env.DATABASE_PATH ?? './data/radar.sqlite');
  const db = new Database(dbPath, { readonly: true });
  const out = await runBackup(db, dbPath);
  db.close();
  console.info(`Backup pronto em ${out}`);
}

main().catch((err) => {
  console.error('Falha no backup:', err);
  process.exit(1);
});
