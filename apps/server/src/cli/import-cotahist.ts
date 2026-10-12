/**
 * Importa o histórico diário da B3 (arquivos COTAHIST) para o banco do Radar.
 *
 * Uso:
 *   pnpm --filter @radar/server import:cotahist 2016 2017 2018      (baixa da B3)
 *   pnpm --filter @radar/server import:cotahist --file COTAHIST_A2024.ZIP
 *   ... --tickers PETR4,VALE3   (opcional: só esses códigos)
 *
 * ❌ A URL de download não foi verificada nesta versão; se falhar, baixe o arquivo pelo site da B3
 * (Market Data → Histórico → Séries históricas) e use --file.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSessionDate } from '@radar/shared';
import { openDb } from '../db/client';
import { loadEnv } from '../env';
import { CandleStore } from '../market/candle-store';
import { importCotahist } from '../market/cotahist-import';

const URL_TEMPLATE = 'https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A{ANO}.ZIP';

async function main() {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  try {
    process.loadEnvFile?.(resolve(root, '.env'));
  } catch {
    // sem .env
  }
  const env = loadEnv();
  const dbPath = isAbsolute(env.DATABASE_PATH)
    ? env.DATABASE_PATH
    : resolve(root, env.DATABASE_PATH);
  const store = new CandleStore(openDb(dbPath));

  const args = process.argv.slice(2).filter((a) => a !== '--');
  const tIdx = args.indexOf('--tickers');
  const tickers =
    tIdx >= 0
      ? new Set((args[tIdx + 1] ?? '').split(',').map((s) => s.trim().toUpperCase()))
      : undefined;
  const fIdx = args.indexOf('--file');
  const sources: { label: string; load: () => Promise<Uint8Array> }[] = [];
  if (fIdx >= 0 && args[fIdx + 1]) {
    const p = resolve(process.cwd(), args[fIdx + 1] as string);
    sources.push({ label: p, load: async () => new Uint8Array(readFileSync(p)) });
  }
  for (const a of args) {
    if (/^\d{4}$/.test(a)) {
      const url = URL_TEMPLATE.replace('{ANO}', a);
      sources.push({
        label: url,
        load: async () => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
          return new Uint8Array(await res.arrayBuffer());
        },
      });
    }
  }
  if (!sources.length) {
    console.error(
      'Informe anos (ex.: 2020 2021) ou --file <arquivo>. Veja o comentário no topo do script.',
    );
    process.exit(1);
  }
  for (const s of sources) {
    console.info(`Importando ${s.label} …`);
    const r = importCotahist(store, await s.load(), tickers);
    console.info(
      `  ${r.tickers} códigos, ${r.candles} candles diários (NÃO ajustados por proventos).`,
    );
    for (const [t, dates] of Object.entries(r.suspicious)) {
      console.warn(
        `  ⚠ ${t}: gap > 35% em ${dates.map((d) => formatSessionDate(d)).join(', ')} — provável desdobramento/grupamento`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
