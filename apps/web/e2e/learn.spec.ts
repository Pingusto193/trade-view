import { expect, test, type Page } from '@playwright/test';

const savedPrefs = (page: Page) =>
  page.waitForResponse((r) => r.url().includes('/api/prefs') && r.request().method() === 'PUT');

test('exercício de leitura: pergunta sem datas nem marcações, corrige e revela o ativo', async ({
  page,
}) => {
  await page.goto('/exercicios?nivel=2');
  await page.getByRole('button', { name: 'Começar' }).click();
  const qs = page.getByRole('region', { name: 'Perguntas' });
  await expect(qs).toBeVisible();
  await expect(page.getByTestId('legend-time')).toHaveCount(0);
  // as perguntas "se sim" ficam desligadas até responder "sim"
  await expect(qs.getByRole('radio').nth(2)).toBeDisabled();
  await qs.getByRole('radio', { name: 'Não' }).first().check();
  await qs.getByRole('button', { name: 'Responder' }).click();
  const res = page.getByTestId('exercise-result');
  await expect(res).toContainText(/\d de \d/);
  await expect(res).toContainText('Ativo: SIM');
  await expect(page.getByTestId('res-tem')).toBeVisible();
  // depois de responder, as datas voltam
  await expect(page.getByTestId('legend-time')).toBeAttached();
  await expect(page.getByRole('button', { name: 'Próximo exercício' })).toBeEnabled();
});

test('trilha: marca leitura, salva no servidor e mostra o progresso', async ({ page }) => {
  await page.goto('/trilha');
  await expect(page.getByTestId('trail-summary')).toContainText('módulos completos');
  const mod = page.getByTestId('trail-candles');
  const box = mod.getByRole('checkbox').first();
  if (await box.isChecked()) await Promise.all([savedPrefs(page), box.uncheck()]);
  await Promise.all([savedPrefs(page), box.check()]);
  await page.reload();
  await expect(page.getByTestId('trail-candles').getByRole('checkbox').first()).toBeChecked();
  await expect(mod.getByRole('link', { name: 'praticar' })).toHaveAttribute(
    'href',
    /\/exercicios\?nivel=1&modulo=candles/,
  );
  await Promise.all([
    savedPrefs(page),
    page.getByTestId('trail-candles').getByRole('checkbox').first().uncheck(),
  ]);
});
