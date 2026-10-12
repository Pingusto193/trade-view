import { z } from 'zod';

const bool = z
  .enum(['0', '1', 'true', 'false', ''])
  .optional()
  .transform((v) => v === '1' || v === 'true');

/**
 * Variáveis de ambiente (ver `.env.example` na raiz). Segredos nunca vão para o navegador.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(8787),
  DATABASE_PATH: z.string().default('./data/radar.sqlite'),
  /** Endereço público (https://...) — usado em links de alertas e no cookie seguro. */
  PUBLIC_URL: z.string().default('http://localhost:5173'),
  /** Liga a fonte de DADOS SIMULADOS (somente desenvolvimento). */
  RADAR_SIMULATED: bool,
  /** Desliga o login (somente desenvolvimento local; ignorado em produção). */
  RADAR_DEV_NO_AUTH: bool,
  /** Ligue só quando o servidor estiver atrás de um proxy (ex.: Caddy), para ler o IP real. */
  TRUST_PROXY: bool,
  /** Pasta com o build do front (apps/web/dist) para servir em produção. */
  WEB_DIST: z.string().optional(),
  /** Chave (base64, 32 bytes) do cofre de segredos. Vazia = arquivo app-secret.key ao lado do banco. */
  APP_SECRET: z.string().optional(),
  ALPACA_KEY_ID: z.string().optional(),
  ALPACA_SECRET_KEY: z.string().optional(),
  BRAPI_TOKEN: z.string().optional(),
  /** E-mail dos alertas (SMTP). Sem SMTP_HOST, o canal e-mail fica indisponível. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  /** 1 = TLS direto (porta 465); 0 = STARTTLS (porta 587). */
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  /** Chaves VAPID do Web Push. Vazias = geradas uma vez e guardadas em vapid.json ao lado do banco. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  /** Contato exigido pelo Web Push (mailto: ou https:). */
  VAPID_SUBJECT: z.string().optional(),
});
export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida no .env — ${msg}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.RADAR_SIMULATED) {
    throw new Error('RADAR_SIMULATED não pode ser ligado em produção (SPEC §3.1).');
  }
  if (env.NODE_ENV === 'production') env.RADAR_DEV_NO_AUTH = false;
  return env;
}
