import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { listBackups, pruneBackups, runBackup } from '../src/backup';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const NOW = Date.UTC(2026, 9, 13, 18);

describe('exportar e importar (JSON)', () => {
  it('exporta só os dados do usuário, sem senha/sessões, e a importação restaura tudo', async () => {
    const t = await testApp({ now: () => NOW });
    close = () => t.app.close();
    const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) => {
      const r = await t.app.inject({
        method,
        url,
        ...(body !== undefined
          ? { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }
          : {}),
      });
      return {
        status: r.statusCode,
        body: r.json() as Record<string, unknown>,
        headers: r.headers,
      };
    };
    await call('PUT', '/api/prefs', { riskPct: 0.5, trailRead: ['candles'] });
    const tr = await call('POST', '/api/real/trades', {
      symbol: 'PETR4',
      market: 'b3-acao',
      side: 'long',
      currency: 'BRL',
      pointValue: 1,
      initialStop: 36,
      target: null,
      entry: { time: NOW - 3_600_000, kind: 'entrada', qty: 100, price: 38 },
    });
    expect(tr.status).toBe(200);

    const ex = await call('GET', '/api/export');
    expect(ex.status).toBe(200);
    expect(String(ex.headers['content-disposition'])).toMatch(/radar-2026-10-13\.json/);
    const file = ex.body as { format: string; tables: Record<string, unknown[]> };
    expect(file.format).toBe('radar-export');
    expect(file.tables.real_trades).toHaveLength(1);
    expect(file.tables.real_fills).toHaveLength(1);
    expect(file.tables.preferences).toHaveLength(1);
    for (const secret of [
      'users',
      'sessions',
      'login_attempts',
      'push_subscriptions',
      'notify_settings',
      'mt5_tokens',
    ])
      expect(file.tables[secret], secret).toBeUndefined();
    expect(JSON.stringify(file)).not.toMatch(/argon2|password/i);

    // apaga e importa de volta
    await call('DELETE', `/api/real/trades/${(tr.body as { id: string }).id}`);
    await call('PUT', '/api/prefs', { riskPct: 2 });
    expect(((await call('GET', '/api/real/journal')).body.trades as unknown[]).length).toBe(0);
    const imp = await call('POST', '/api/import', file);
    expect(imp.status).toBe(200);
    expect(imp.body.rows).toBeGreaterThanOrEqual(3);
    const j = (await call('GET', '/api/real/journal')).body as { trades: { fills: unknown[] }[] };
    expect(j.trades).toHaveLength(1);
    expect(j.trades[0]?.fills).toHaveLength(1);
    expect((await call('GET', '/api/prefs')).body).toMatchObject({
      riskPct: 0.5,
      trailRead: ['candles'],
    });

    // arquivo errado: recusado e nada muda
    const bad = await call('POST', '/api/import', { format: 'outro', tables: {} });
    expect(bad.status).toBe(400);
    const unk = await call('POST', '/api/import', { ...file, tables: { users: [{ id: 9 }] } });
    expect(unk.status).toBe(400);
    expect(((await call('GET', '/api/real/journal')).body.trades as unknown[]).length).toBe(1);
  });
});

describe('backup automático', () => {
  it('copia o banco consistente e mantém só os mais novos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-bkp-'));
    try {
      const path = join(dir, 'radar.sqlite');
      const db = new Database(path);
      db.exec('CREATE TABLE x (v INTEGER); INSERT INTO x VALUES (42);');
      for (const d of [1, 2, 3]) await runBackup(db, path, new Date(Date.UTC(2026, 9, d, 3)));
      db.close();
      const list = listBackups(path);
      expect(list).toHaveLength(3);
      expect(list[0]).toMatch(/^2026-10-03T03/);
      const copy = new Database(join(dir, 'backups', list[0] as string, 'radar.sqlite'), {
        readonly: true,
      });
      expect(copy.prepare('SELECT v FROM x').get()).toEqual({ v: 42 });
      copy.close();
      expect(pruneBackups(path, 2)).toEqual([list[2]]);
      expect(listBackups(path)).toHaveLength(2);
      expect(existsSync(join(dir, 'backups', list[2] as string))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
