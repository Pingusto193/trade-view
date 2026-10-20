import { expect, test } from '@playwright/test';

test('modo simples: só o essencial, leitura da tendência com histórico honesto e volta ao completo', async ({
  page,
}) => {
  await page.goto('/grafico?id=sim:SIMBTC&tf=1d');
  const modes = page.getByRole('group', { name: 'Modo do gráfico' });
  const saved = () =>
    page.waitForResponse(
      (r) =>
        r.url().includes('/api/prefs') &&
        r.request().method() === 'PUT' &&
        (r.request().postData() ?? '').includes('"view"'),
    );
  try {
    await Promise.all([saved(), modes.getByRole('button', { name: 'Simples' }).click()]);
    const card = page.getByTestId('reading-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('reading-trend')).toHaveText(
      /Tendência de alta|Tendência de baixa|Sem tendência \(lateral\)|Ainda sem dados suficientes/,
    );
    await expect(card).toContainText(
      /subiu mais que o normal|caiu mais que o normal|sem vantagem clara|Poucos casos|Sem dados/,
    );
    // ferramentas avançadas escondidas
    await expect(page.getByLabel('Preset de indicadores')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '◎ Setups' })).toHaveCount(0);
    // detalhes: comparação com um candle qualquer e o aviso de que não é previsão
    const details = page.getByTestId('reading-details');
    if (!(await details.isVisible())) await card.getByRole('button').first().click();
    await expect(details).toContainText('Num candle qualquer');
    await expect(details).toContainText('Não é previsão');
    // cabe em 375 px sem rolagem lateral
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // a preferência fica no servidor
    const prefs = await page.evaluate(() => fetch('/api/prefs').then((r) => r.json()));
    expect(prefs.view).toBe('simples');
  } finally {
    await Promise.all([saved(), modes.getByRole('button', { name: 'Completo' }).click()]);
  }
  await expect(page.getByLabel('Preset de indicadores')).toBeVisible();
  await expect(page.getByTestId('reading-card')).toHaveCount(0);
});
