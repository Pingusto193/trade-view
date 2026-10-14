import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';

/**
 * Backup completo (SPEC §17, Fase 8): cópia consistente do banco (API de backup do SQLite, funciona com
 * o servidor rodando) + chave do cofre + chaves VAPID. Sem a chave do cofre, tokens guardados (ex.:
 * Telegram) não podem ser lidos: ela vai junto e deve ficar guardada em lugar seguro.
 */
export async function runBackup(sqlite: Database.Database, dbPath: string, now = new Date()) {
  const dir = dirname(dbPath);
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = join(dir, 'backups', stamp);
  mkdirSync(out, { recursive: true });
  await sqlite.backup(join(out, 'radar.sqlite'));
  for (const f of ['app-secret.key', 'vapid.json']) {
    if (existsSync(join(dir, f))) copyFileSync(join(dir, f), join(out, f));
  }
  return out;
}

/** Backups existentes, do mais novo ao mais antigo (nomes = data ISO, ordem alfabética = cronológica). */
export function listBackups(dbPath: string): string[] {
  const root = join(dirname(dbPath), 'backups');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n) && statSync(join(root, n)).isDirectory())
    .sort()
    .reverse();
}

/** Apaga os backups além dos `keep` mais novos. */
export function pruneBackups(dbPath: string, keep: number): string[] {
  const root = join(dirname(dbPath), 'backups');
  const old = listBackups(dbPath).slice(keep);
  for (const n of old) rmSync(join(root, n), { recursive: true, force: true });
  return old;
}

/**
 * Backup automático (SPEC §17: diário, com retenção). Confere a cada hora; faz um backup quando o mais
 * novo tem mais de `everyHours`. Falha vira log de erro — nunca derruba o servidor.
 */
export function scheduleBackups(o: {
  sqlite: Database.Database;
  dbPath: string;
  everyHours: number;
  keep: number;
  log: { info(msg: string): void; error(msg: string): void };
  now?: () => number;
}): () => void {
  const now = o.now ?? Date.now;
  const tick = async () => {
    try {
      const last = listBackups(o.dbPath)[0];
      const lastMs = last
        ? Date.parse(last.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3') + 'Z')
        : 0;
      if (now() - lastMs < o.everyHours * 3_600_000) return;
      const out = await runBackup(o.sqlite, o.dbPath, new Date(now()));
      const gone = pruneBackups(o.dbPath, o.keep);
      o.log.info(
        `backup automático pronto em ${out}${gone.length ? ` (${gone.length} antigos apagados)` : ''}`,
      );
    } catch (err) {
      o.log.error(`backup automático falhou: ${(err as Error).message}`);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 3_600_000);
  timer.unref();
  return () => clearInterval(timer);
}
