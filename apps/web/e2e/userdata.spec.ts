import { expect, test } from '@playwright/test';

test('watchlist: adicionar ativo simulado e abrir o gráfico pela lista', async ({ page }) => {
  test.skip(test.info().project.name !== 'iphone', 'roda no celular (tela Listas)');
  await page.goto('/listas');
  await expect(page.getByLabel('Lista')).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar ativo' }).click();
  await page.getByLabel('Texto da busca').fill('SIMBTC');
  await page.getByRole('button', { name: /SIMBTC/ }).click();
  const item = page.getByRole('button', { name: /SIMBTC/ }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(/grafico\?id=sim%3ASIMBTC|grafico\?id=sim:SIMBTC/);
});

test('presets: desligar a MME 9 e salvar como preset novo', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'roda uma vez');
  page.on('dialog', (d) => void d.accept('Meu preset de teste'));
  await page.goto('/grafico?id=sim:SIMBTC&tf=1d');
  await page.getByRole('button', { name: 'Editar indicadores' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar indicadores' });
  await expect(dialog).toContainText('Preset pronto');
  await dialog.getByRole('checkbox').first().uncheck();
  await dialog.getByRole('button', { name: 'Salvar como novo' }).click();
  await expect(page.getByLabel('Preset de indicadores')).toHaveValue(/meu-preset-de-teste/);
  await expect(page.getByLabel('Preset de indicadores').locator('option:checked')).toHaveText(
    'Meu preset de teste',
  );
});
