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

test('preferência trocada e app recarregado na hora: a troca não se perde', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'roda uma vez');
  await page.goto('/grafico?id=sim:SIMBTC&tf=1d');
  const preset = page.getByLabel('Preset de indicadores');
  await expect(preset).toBeVisible();
  const before = await preset.inputValue();
  const target = before === 'limpo' ? 'padrao-do-canal' : 'limpo';
  try {
    // recarrega logo depois de trocar (antes do envio agrupado de 400 ms): antes, a troca se perdia e
    // o valor velho do servidor sobrescrevia a cópia local
    await preset.selectOption(target);
    await page.reload();
    await expect(preset).toHaveValue(target);
    const server = await page.evaluate(() =>
      fetch('/api/prefs').then((r) => r.json() as Promise<{ presetId: string }>),
    );
    expect(server.presetId).toBe(target);
  } finally {
    await preset.selectOption(before);
    await page.waitForResponse(
      (r) =>
        r.url().includes('/api/prefs') &&
        r.request().method() === 'PUT' &&
        (r.request().postData() ?? '').includes('"presetId"'),
    );
  }
});
