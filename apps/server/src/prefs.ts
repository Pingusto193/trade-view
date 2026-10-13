import { setupParamsSchema, type SetupParams } from '@radar/core';
import { DEFAULT_PREFS, prefsSchema, type Prefs } from '@radar/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { preferences } from './db/schema';

/** Preferências guardadas do usuário (ausentes ou inválidas → padrão). */
export function readPrefs(db: Db, userId: number): Prefs {
  const row = db.select().from(preferences).where(eq(preferences.userId, userId)).get();
  const parsed = prefsSchema.safeParse(row ? JSON.parse(row.json) : {});
  return parsed.success ? parsed.data : DEFAULT_PREFS;
}

/** Parâmetros dos setups das preferências, validados pelo schema do core (inválidos → padrão). */
export function userSetupParams(prefs: Prefs): SetupParams {
  const parsed = setupParamsSchema.safeParse(prefs.setupParams ?? {});
  return parsed.success ? parsed.data : setupParamsSchema.parse({});
}
