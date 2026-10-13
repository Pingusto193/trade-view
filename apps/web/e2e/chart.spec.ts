import { expect, test } from '@playwright/test';

const SIM = '/grafico?id=sim:SIMBTC';

test('abre o gráfico com selo da fonte e faixa de DADOS SIMULADOS', async ({ page }) => {
  await page.goto(`${SIM}&tf=1d`);
  await expect(
    page.getByText('DADOS SIMULADOS — não representam nenhum mercado real'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Detalhes da fonte de dados' })).toContainText(
    'Simulador',
  );
  await expect(page.getByTestId('chart-canvas').locator('canvas').first()).toBeVisible();
});

test('candle de 1 minuto atualiza sozinho (tempo real via WebSocket)', async ({ page }) => {
  await page.goto(`${SIM}&tf=1m`);
  const close = page.locator('b.text-up, b.text-down').first();
  await expect(close).toBeVisible();
  const first = await close.textContent();
  await expect.poll(async () => close.textContent(), { timeout: 10_000 }).not.toBe(first);
});

test('a legenda continua ao vivo depois que o minuto vira (candle novo)', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'um projeto basta (espera até 60 s)');
  test.setTimeout(100_000);
  await page.goto(`${SIM}&tf=1m`);
  const date = page.locator('[data-testid="legend-time"]');
  await expect(date).toBeVisible();
  const startLabel = await date.textContent();
  // espera o candle novo começar
  await expect.poll(async () => date.textContent(), { timeout: 70_000 }).not.toBe(startLabel);
  const close = page.locator('b.text-up, b.text-down').first();
  const first = await close.textContent();
  await expect.poll(async () => close.textContent(), { timeout: 10_000 }).not.toBe(first);
});

test('trocar escala atualiza a URL e o rótulo', async ({ page }) => {
  await page.goto(`${SIM}&tf=1d`);
  await page.getByRole('button', { name: 'S', exact: true }).click();
  await expect(page).toHaveURL(/tf=1w/);
  await expect(page.getByText('Semanal').first()).toBeVisible();
});

test('modo 3 escalas mostra Contexto, Setup e Gatilho', async ({ page }) => {
  await page.goto(`${SIM}&tf=1d&modo=3`);
  for (const role of ['Contexto', 'Setup', 'Gatilho']) {
    await expect(page.getByText(role, { exact: false }).first()).toBeVisible();
  }
});

test('busca unificada encontra o ativo simulado', async ({ page }) => {
  await page.goto(`${SIM}&tf=1d`);
  await page.getByRole('button', { name: 'Buscar ativo' }).click();
  await page.getByLabel('Texto da busca').fill('SIMACAO');
  await page.getByRole('button', { name: /SIMACAO/ }).click();
  await expect(page).toHaveURL(/id=sim%3ASIMACAO|id=sim:SIMACAO/);
});

test('sem rolagem horizontal da página (cabe em 375 px)', async ({ page }) => {
  await page.goto(`${SIM}&tf=1d`);
  await expect(page.getByTestId('chart-canvas').locator('canvas').first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('diálogos ficam acima das alças internas do gráfico (toque não é roubado)', async ({
  page,
}) => {
  await page.goto('/grafico?id=sim:SIMACAO&tf=1d');
  await expect(page.getByTestId('chart-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Real', exact: true }).click();
  const btn = page
    .getByRole('dialog', { name: 'Mudar para o modo Real' })
    .getByRole('button', { name: 'Continuar no treino' });
  await btn.scrollIntoViewIfNeeded();
  await expect(btn).toBeInViewport();
  const b = (await btn.boundingBox())!;
  // põe a alça entre painéis do gráfico (z-index 50 da biblioteca) exatamente sob o botão
  const moved = await page.evaluate(
    (y) => {
      const h = [
        ...document.querySelectorAll<HTMLDivElement>('[data-testid="chart-canvas"] div'),
      ].find((d) => d.style.zIndex === '50');
      if (!h) return false;
      Object.assign(h.style, {
        position: 'fixed',
        top: `${y - 10}px`,
        left: '0',
        width: '100%',
        height: '20px',
      });
      return true;
    },
    b.y + b.height / 2,
  );
  expect(moved).toBe(true);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.getByRole('dialog', { name: 'Mudar para o modo Real' })).toBeHidden();
});

test('tablet (820 px): menu não transborda e a chave Treino/Real fica visível', async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.goto('/grafico?id=sim:SIMACAO&tf=1d');
  await expect(page.getByRole('group', { name: 'Modo' })).toBeInViewport();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
