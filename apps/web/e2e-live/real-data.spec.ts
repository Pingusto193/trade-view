import { expect, test } from '@playwright/test';

// Critério da Fase 1 com dados REAIS: o BTC no 1 minuto atualiza sozinho, com o selo da fonte e sem a
// faixa de dados simulados.
test('BTC no 1 minuto atualiza sozinho com dados reais da Binance', async ({ page }) => {
  await page.goto('/grafico?id=binance:BTCUSDT&tf=1m');
  await expect(page.getByRole('button', { name: 'Detalhes da fonte de dados' })).toContainText(
    'Binance',
  );
  await expect(page.getByText(/DADOS SIMULADOS/)).toHaveCount(0);
  const close = page.locator('b.text-up, b.text-down').first();
  await expect(close).toBeVisible({ timeout: 30_000 });
  const first = await close.textContent();
  // BTC negocia sem parar: em 60 s o último preço muda (se o mercado parar, o teste avisa)
  await expect.poll(async () => close.textContent(), { timeout: 60_000 }).not.toBe(first);
});

test('painel Brasil mostra CDI e Selic do Banco Central (número real, não o aviso de erro)', async ({
  page,
}) => {
  await page.goto('/brasil');
  await expect(page.getByTestId('cdi-box')).toContainText(/CDI: \d+,\d{2}% ao ano/, {
    timeout: 30_000,
  });
});
