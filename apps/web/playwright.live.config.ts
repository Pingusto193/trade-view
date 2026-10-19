import { defineConfig, devices } from '@playwright/test';

/**
 * E2E com DADOS REAIS (precisa de internet): servidor sem simulador, fontes de verdade.
 * Roda no workflow "Dados reais" do GitHub. Local: pnpm --filter @radar/web exec playwright test -c
 * playwright.live.config.ts
 */
const SERVER_PORT = 8797;
const WEB_PORT = 5197;
const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e-live',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'iphone',
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
        RADAR_SIMULATED: '0',
        RATE_LIMIT_MAX: '100000',
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
  ],
});
