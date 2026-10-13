import { expect, test } from '@playwright/test';

test('scanner: varre os ativos simulados, mostra tabela ordenável e cartões e abre o gráfico', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/scanner');
  await expect(page.getByRole('heading', { name: /Scanner/ })).toBeVisible();
  await expect(page.getByText('Não é recomendação')).toBeVisible();
  await page.getByLabel('Ativos').selectOption('suggested:sim');
  await page.getByLabel('Tempo gráfico').selectOption('1d');
  await page.getByRole('button', { name: 'Varrer agora' }).click();

  const result = page.getByTestId('scan-result');
  await expect(result).toBeVisible({ timeout: 60_000 });
  // sem filtros, todos os ativos que têm dados "passam"
  await result.getByRole('tab', { name: /Todos/ }).click();
  const table = result.getByRole('table', { name: 'Resultado do scanner' });
  await expect(table.getByRole('row')).toHaveCount(4, { timeout: 60_000 }); // cabeçalho + 3
  await expect(result).toContainText('DADOS SIMULADOS');

  // ordenar por uma coluna muda o aria-sort
  const sortable = table.locator('th[aria-sort]').first();
  await sortable.getByRole('button').click();
  await expect(sortable).toHaveAttribute('aria-sort', /ascending|descending/);

  // cartões com mini-gráfico
  await result.getByRole('button', { name: /cart/i }).click();
  await expect(result.getByTestId('scan-card').first()).toBeVisible();

  // tocar no ativo abre o modo 3 escalas
  await result
    .getByRole('button', { name: /Abrir SIMACAO no gráfico/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/grafico\?.*id=sim%3ASIMACAO|\/grafico\?.*id=sim:SIMACAO/);
  await expect(page).toHaveURL(/modo=3/);
});
