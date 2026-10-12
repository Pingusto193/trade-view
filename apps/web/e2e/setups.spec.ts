import { expect, test, type Page } from '@playwright/test';

const SIM = '/grafico?id=sim:SIMACAO&tf=1d';

/** Abre o painel lateral (no computador largo o de Setups já começa aberto). */
async function openSide(page: Page, button: string, name: string) {
  const panel = page.getByRole('complementary', { name });
  await expect(page.getByRole('button', { name: button })).toBeVisible();
  if (!(await panel.isVisible())) await page.getByRole('button', { name: button }).click();
  await expect(panel).toBeVisible();
  return panel;
}

test('painel de setups mostra histórico com motivo e aviso de que não é backtest', async ({
  page,
}) => {
  await page.goto(SIM);
  const panel = await openSide(page, '◎ Setups', 'Setups');
  await expect(panel.getByText(/isto NÃO é backtest/)).toBeVisible();
  await panel.getByRole('button', { name: 'Histórico' }).click();
  // pelo menos uma ocorrência com o "porquê" em texto
  const first = panel.locator('li button[aria-expanded]').first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  await first.click();
  await expect(panel.getByText(/Gatilho .* Stop .* Alvo/).first()).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Ver no gráfico' }).first()).toBeVisible();
});

test('desligar um setup risca o filtro e persiste', async ({ page }) => {
  await page.goto(SIM);
  const panel = await openSide(page, '◎ Setups', 'Setups');
  const btn = panel.getByRole('button', { name: '9.1', exact: true });
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await openSide(page, '◎ Setups', 'Setups');
  await expect(
    page
      .getByRole('complementary', { name: 'Setups' })
      .getByRole('button', { name: '9.1', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('painel de contexto explica o porquê de cada item', async ({ page }) => {
  await page.goto(SIM);
  const panel = await openSide(page, '🧭 Contexto', 'Contexto');
  await expect(panel.getByText('Tendência').first()).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: /Força \(ADX\)/ }).click();
  await expect(panel.getByText(/ADX/).nth(1)).toBeVisible();
  await expect(panel.getByText(/não é recomendação/)).toBeVisible();
});
