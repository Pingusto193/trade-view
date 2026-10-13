import { expect, test } from '@playwright/test';

const AVISO = 'VWAP só faz sentido no intradiário';

test('VWAP ligada: some no diário com aviso na legenda e aparece no intradiário', async ({
  page,
}) => {
  const name = `Com VWAP ${test.info().project.name}`;
  page.on('dialog', (d) => void d.accept(name));
  const savedPrefs = () =>
    page.waitForResponse((r) => r.url().includes('/api/prefs') && r.request().method() === 'PUT');
  await page.goto('/grafico?id=sim:SIMBTC&tf=1d');
  // estado previsível: parte do preset padrão (outro teste pode ter deixado outro salvo)
  const preset = page.getByLabel('Preset de indicadores');
  if ((await preset.inputValue()) !== 'padrao-do-canal')
    await Promise.all([savedPrefs(), preset.selectOption('padrao-do-canal')]);
  await page.getByRole('button', { name: 'Editar indicadores' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar indicadores' });
  await dialog.getByRole('listitem').filter({ hasText: 'VWAP' }).getByRole('checkbox').check();
  // o preset escolhido vai ao servidor com atraso: espera antes de recarregar a página
  await Promise.all([
    savedPrefs(),
    dialog.getByRole('button', { name: 'Salvar como novo' }).click(),
  ]);
  await expect(preset.locator('option:checked')).toHaveText(name);
  try {
    // diário: sem linha nem valor de VWAP; o aviso aparece sem abrir os valores (celular também)
    await expect(page.getByTestId('legend-skipped')).toContainText(AVISO);
    await expect(page.getByTestId('legend-skipped')).toBeVisible();
    await expect(page.getByText(/^VWAP \d/)).toHaveCount(0);

    // intradiário: a VWAP volta (no celular, abrindo os valores) e o aviso some
    await page.goto('/grafico?id=sim:SIMBTC&tf=5m');
    const vwap = page.getByText(/^VWAP \d/);
    await expect(vwap).toBeAttached();
    if (!(await vwap.isVisible()))
      await page.getByRole('button', { name: 'indicadores', exact: true }).click();
    await expect(vwap).toBeVisible();
    await expect(page.getByTestId('legend-skipped')).toHaveCount(0);
  } finally {
    // o preset escolhido fica salvo no servidor: devolve o padrão para não afetar outros testes
    await Promise.all([savedPrefs(), preset.selectOption('padrao-do-canal')]);
  }
});
