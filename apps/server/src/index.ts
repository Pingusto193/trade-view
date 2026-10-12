import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdapterRegistry } from '@radar/data';
import { buildApp } from './app';
import { openDb } from './db/client';
import { loadEnv } from './env';

/** Ponto de entrada do servidor do Radar. */
async function main() {
  // Caminhos relativos do .env são relativos à raiz do repositório.
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  try {
    process.loadEnvFile?.(resolve(root, '.env'));
  } catch {
    // sem .env: usa só as variáveis do ambiente
  }
  const env = loadEnv();
  const fromRoot = (p: string) => (p === ':memory:' || isAbsolute(p) ? p : resolve(root, p));
  env.DATABASE_PATH = fromRoot(env.DATABASE_PATH);
  if (env.WEB_DIST) env.WEB_DIST = fromRoot(env.WEB_DIST);
  const db = openDb(env.DATABASE_PATH);
  const registry = AdapterRegistry.fromConfig({
    ...(env.ALPACA_KEY_ID ? { alpacaKeyId: env.ALPACA_KEY_ID } : {}),
    ...(env.ALPACA_SECRET_KEY ? { alpacaSecretKey: env.ALPACA_SECRET_KEY } : {}),
    ...(env.BRAPI_TOKEN ? { brapiToken: env.BRAPI_TOKEN } : {}),
    simulated: env.RADAR_SIMULATED,
  });
  const { app, alerts } = await buildApp({ env, db, registry });

  const shutdown = async (sig: string) => {
    app.log.info(`recebido ${sig}, encerrando…`);
    await app.close();
    db.$client.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.HOST, port: env.PORT });
  // avaliação dos alertas 24 h (SPEC §10)
  await alerts.start();
  if (env.RADAR_SIMULATED)
    app.log.warn('ATENÇÃO: fonte de DADOS SIMULADOS ligada (somente desenvolvimento)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
