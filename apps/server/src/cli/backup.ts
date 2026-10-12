import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Backup completo (Fase 8): cópia consistente do banco (API de backup do SQLite, funciona com o
 * servidor rodando) + chave do cofre + chaves VAPID. Sem a chave do cofre, tokens guardados (ex.:
 * Telegram) não podem ser lidos: ela vai junto e deve ficar guardada em lugar seguro.
 */
async function main() {
  const dbPath = resolve(process.env.DATABASE_PATH ?? './data/radar.sqlite');
  const dir = dirname(dbPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = join(dir, 'backups', stamp);
  mkdirSync(out, { recursive: true });
  const db = new Database(dbPath, { readonly: true });
  await db.backup(join(out, 'radar.sqlite'));
  db.close();
  for (const f of ['app-secret.key', 'vapid.json']) {
    if (existsSync(join(dir, f))) copyFileSync(join(dir, f), join(out, f));
  }
  console.info(`Backup pronto em ${out}`);
}

main().catch((err) => {
  console.error('Falha no backup:', err);
  process.exit(1);
});
