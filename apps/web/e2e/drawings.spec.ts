import { expect, test } from '@playwright/test';

/**
 * Critério de aceite da Fase 2 (SPEC §20): "algo desenhado no PC aparece no celular".
 * Dois contextos de navegador independentes (PC e celular), mesmo usuário.
 */
test('linha desenhada no PC aparece no celular sem recarregar', async ({ browser, baseURL }) => {
  test.skip(test.info().project.name !== 'desktop', 'cenário com dois aparelhos roda uma vez');
  const url = `${baseURL}/grafico?id=sim:SIMFX&tf=1d`;
  const pc = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const phone = await (
    await browser.newContext({
      viewport: { width: 375, height: 760 },
      isMobile: true,
      hasTouch: true,
    })
  ).newPage();

  await phone.goto(url);
  await phone.getByRole('button', { name: /Desenhos/ }).click();
  await expect(phone.getByText(/Desenhos deste ativo \(0\)/)).toBeVisible();

  await pc.goto(url);
  await expect(pc.getByTestId('chart-canvas').locator('canvas').first()).toBeVisible();
  await pc.getByRole('button', { name: '✏️ Desenhar' }).click();
  await pc.getByRole('button', { name: 'Linha horizontal' }).click();
  const box = await pc.getByTestId('chart-canvas').boundingBox();
  if (!box) throw new Error('gráfico sem tamanho');
  await pc.waitForTimeout(500);
  await pc.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await expect(pc.getByRole('dialog', { name: 'Desenho selecionado' })).toContainText(
    'Linha horizontal',
  );

  // o celular recebe o aviso pelo WebSocket e recarrega os desenhos do ativo
  await expect(phone.getByText(/Desenhos deste ativo \(1\)/)).toBeVisible({ timeout: 10_000 });
  await expect(phone.getByText('Linha horizontal')).toBeVisible();
});

test('Delete apaga o desenho selecionado; Esc cancela a ferramenta', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'atalhos de teclado são do computador');
  await page.goto('/grafico?id=sim:SIMACAO&tf=1d');
  await expect(page.getByTestId('chart-canvas').locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press('Alt+KeyH');
  await expect(page.getByRole('button', { name: 'Linha horizontal' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Linha horizontal' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  await page.keyboard.press('Alt+KeyH');
  const box = await page.getByTestId('chart-canvas').boundingBox();
  if (!box) throw new Error('gráfico sem tamanho');
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.35);
  await expect(page.getByRole('dialog', { name: 'Desenho selecionado' })).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('dialog', { name: 'Desenho selecionado' })).toBeHidden();
  await page.getByRole('button', { name: /Desenhos/ }).click();
  await expect(page.getByText(/Desenhos deste ativo \(0\)/)).toBeVisible();
});
