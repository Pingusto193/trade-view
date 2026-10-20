import { expect, test } from '@playwright/test';

test('forex pela internet: atalho EUR/USD na busca e, sem chave, erro honesto (nada inventado)', async ({
  page,
}) => {
  await page.goto('/grafico?id=sim:SIMBTC&tf=1d');
  await page.getByRole('button', { name: 'Buscar ativo' }).click();
  const quick = page.getByLabel('Atalhos');
  await expect(quick).toContainText('Forex');
  await quick.getByRole('button', { name: 'EUR/USD' }).click();
  await expect(page).toHaveURL(/id=fx(%3A|:)EURUSD/);
  // o servidor de teste não tem TWELVE_DATA_KEY: a tela diz o que falta
  await expect(page.getByText(/defina TWELVE_DATA_KEY/).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Nenhum dado é inventado/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Detalhes da fonte de dados' })).toContainText(
    'Sem volume',
  );

  await page.goto('/fontes');
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByText('Twelve Data', { exact: true }) });
  await expect(row).toContainText('Forex');
  await expect(row).toContainText('sem chave');
  await expect(page.getByText(/800 consultas por dia/)).toBeVisible();
});
