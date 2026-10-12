import { expect, test } from '@playwright/test';

test('painel Brasil: CDI/Selic do Banco Central ou o erro honesto (nunca número inventado)', async ({
  page,
}) => {
  await page.goto('/brasil');
  const box = page.getByTestId('cdi-box');
  await expect(box).toBeVisible();
  // com internet (CI): taxas reais; sem internet (sandbox): mensagem de indisponibilidade
  await expect(box).toContainText(/CDI: \d+,\d{2}% ao ano|Banco Central|ainda não respondeu/, {
    timeout: 20_000,
  });
  await expect(page.getByRole('region', { name: 'Imposto de renda' })).toContainText('15%');
});
