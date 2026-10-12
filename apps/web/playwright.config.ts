import { defineConfig, devices } from '@playwright/test';

/**
 * E2E do Radar. Sobe o servidor com DADOS SIMULADOS (nunca usa a internet) e o front em modo dev.
 * Rodar: pnpm test:e2e
 */
const SERVER_PORT = 8799;
const WEB_PORT = 5199;
// Segundo par servidor/web COM login obrigatório, para o teste de autenticação.
const AUTH_SERVER_PORT = 8798;
const AUTH_WEB_PORT = 5198;
const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  projects: [
    { name: 'desktop', testIgnore: /auth\.spec/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'auth',
      testMatch: /auth\.spec/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${AUTH_WEB_PORT}` },
    },
    {
      name: 'iphone',
      testIgnore: /auth\.spec/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 760 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @radar/server start',
      url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(SERVER_PORT),
        HOST: '127.0.0.1',
        DATABASE_PATH: ':memory:',
        RADAR_SIMULATED: '1',
        RADAR_DEV_NO_AUTH: '1',
      },
    },
    {
      command: `pnpm --filter @radar/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { RADAR_API: `http://127.0.0.1:${SERVER_PORT}` },
    },
    {
      command: 'pnpm --filter @radar/server start',
      url: `http://127.0.0.1:${AUTH_SERVER_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(AUTH_SERVER_PORT),
        HOST: '127.0.0.1',
        DATABASE_PATH: ':memory:',
        RADAR_SIMULATED: '1',
        RADAR_DEV_NO_AUTH: '0',
        PUBLIC_URL: `http://localhost:${AUTH_WEB_PORT}`,
      },
    },
    {
      command: `pnpm --filter @radar/web exec vite --port ${AUTH_WEB_PORT} --strictPort`,
      url: `http://localhost:${AUTH_WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { RADAR_API: `http://127.0.0.1:${AUTH_SERVER_PORT}` },
    },
  ],
});
