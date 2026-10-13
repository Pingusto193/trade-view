import { expect, test } from '@playwright/test';

const AVISO = 'VWAP só faz sentido no intradiário';

test('VWAP ligada: some no diário com aviso na legenda e aparece no intradiário', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop', 'roda uma vez (valores da legenda abertos)');
  page.on('dialog', (d) => void d.accept('Com VWAP'));
  await page.goto('/grafico?id=sim:SIMBTC&tf=1d');
  await page.getByRole('button', { name: 'Editar indicadores' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar indicadores' });
  await dialog.getByRole('listitem').filter({ hasText: 'VWAP' }).getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Salvar como novo' }).click();
  const preset = page.getByLabel('Preset de indicadores');
  await expect(preset.locator('option:checked')).toHaveText('Com VWAP');
  try {
    // diário: sem linha nem valor de VWAP, só o aviso
    await expect(page.getByTestId('legend-skipped')).toHaveText(AVISO);
    await expect(page.getByText(/^MME 9 \d/)).toBeVisible(); // os outros indicadores seguem
    await expect(page.getByText(/^VWAP \d/)).toHaveCount(0);

    // intradiário: a VWAP volta e o aviso some
    await page.goto('/grafico?id=sim:SIMBTC&tf=5m');
    await expect(page.getByText(/^VWAP \d/)).toBeVisible();
    await expect(page.getByTestId('legend-skipped')).toHaveCount(0);
  } finally {
    // o preset escolhido fica salvo no servidor: devolve o padrão para não afetar outros testes
    await preset.selectOption('padrao-do-canal');
  }
});
