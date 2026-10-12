import { expect, test } from '@playwright/test';

test('experimentos: roda o E2 (caudas da Bollinger) e o E1 e mostra resultado, comparação e limitações', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/laboratorio/experimentos');
  await expect(page.getByRole('heading', { name: 'Verificar o youtuber' })).toBeVisible();

  const e2 = page.getByRole('region', { name: /E2 — Fechamentos fora da Bollinger/ });
  await expect(e2.getByText('O vídeo afirma:')).toBeVisible();
  // em desenvolvimento o conjunto padrão são os ativos simulados
  await expect(e2.getByRole('textbox')).toHaveValue(/sim:SIMACAO/);
  await e2.getByRole('button', { name: 'Rodar E2' }).click();
  const r2 = page.getByTestId('exp-result-e2');
  await expect(r2).toBeVisible({ timeout: 60_000 });
  await expect(r2).toContainText(/curva normal: 0,13%/);
  await expect(r2.getByLabel('Avisos sobre os dados')).toContainText('DADOS SIMULADOS');

  const e1 = page.getByRole('region', { name: /E1 — 9.1 com e sem/ });
  await e1.getByRole('button', { name: 'Rodar E1' }).click();
  const r1 = page.getByTestId('exp-result-e1');
  await expect(r1).toBeVisible({ timeout: 60_000 });
  await expect(r1.getByLabel('Resultado por variante')).toContainText('9.1 com o filtro');
  await expect(r1.getByLabel('Comparações')).toContainText(/Com filtro − sem filtro/);
});
