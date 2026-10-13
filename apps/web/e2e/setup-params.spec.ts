import { expect, test, type Page } from '@playwright/test';

const savedPrefs = (page: Page) =>
  page.waitForResponse((r) => r.url().includes('/api/prefs') && r.request().method() === 'PUT');

test('editor de parâmetros: valida, salva no servidor e o laboratório mostra "personalizados"', async ({
  page,
}) => {
  await page.goto('/setups/parametros');
  await expect(page.getByRole('heading', { name: 'Parâmetros dos setups' })).toBeVisible();
  await expect(page.getByText('Antes de mexer')).toBeVisible();
  const save = page.getByRole('button', { name: 'Salvar' });
  // estado previsível: outro teste pode ter deixado algo salvo
  if (await page.getByRole('button', { name: 'Tudo no padrão' }).isEnabled()) {
    await page.getByRole('button', { name: 'Tudo no padrão' }).click();
    await Promise.all([savedPrefs(page), save.click()]);
  }
  await expect(save).toBeDisabled();

  const group = page.getByTestId('group-reflexivity');
  await group.locator('summary').click();
  const field = page.getByTestId('p-reflexivity-radarExpiryBars');
  const input = field.getByRole('spinbutton');
  await input.scrollIntoViewIfNeeded();
  await expect(input).toHaveValue('104');

  // fora do permitido: mensagem e Salvar desligado
  await input.fill('3');
  await expect(field.getByText('Fora do permitido: de 4 a 520')).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(page.getByText('Corrija os campos marcados para salvar.')).toBeVisible();

  // válido: marca "alterado", mostra o padrão e salva
  await input.fill('200');
  await expect(field.getByText('alterado')).toBeVisible();
  await expect(field.getByText('padrão: 104')).toBeVisible();
  await expect(group.locator('summary')).toContainText('1 alterado');
  await Promise.all([savedPrefs(page), save.click()]);
  await expect(page.getByText('Salvo.')).toBeVisible();

  try {
    // persiste no servidor
    await page.reload();
    await page.getByTestId('group-reflexivity').locator('summary').click();
    await expect(
      page.getByTestId('p-reflexivity-radarExpiryBars').getByRole('spinbutton'),
    ).toHaveValue('200');

    // o laboratório avisa que o teste usa parâmetros personalizados (só conta os setups marcados)
    await page.goto('/laboratorio?setup=reflexivity&tf=1w');
    await expect(page.getByTestId('lab-params')).toContainText('personalizados (1 valor alterado)');
    await page.goto('/laboratorio?setup=s91&tf=1d');
    await expect(page.getByTestId('lab-params')).toContainText('padrão');
  } finally {
    await page.goto('/setups/parametros');
    await page.getByRole('button', { name: 'Tudo no padrão' }).click();
    await Promise.all([savedPrefs(page), page.getByRole('button', { name: 'Salvar' }).click()]);
  }
});
