import { expect, test } from '@playwright/test';

test('laboratório: roda um backtest com custos, mostra veredito, CDI, curva e registra a tentativa', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/laboratorio?id=sim:SIMACAO&setup=s91&tf=1d');
  await expect(page.getByRole('heading', { name: /Laboratório/ })).toBeVisible();
  await page.getByLabel('Candles para trás').fill('1500');
  await page.getByRole('button', { name: 'Rodar teste' }).click();

  // sem internet o CDI pode faltar: o laboratório diz isso em vez de inventar
  const verdict = page.getByTestId('lab-verdict');
  await expect(verdict).toBeVisible({ timeout: 60_000 });
  await expect(verdict).toContainText(/Aprovado|Promissor|Evidência fraca|Inconclusivo|Reprovado/);
  await expect(verdict).toContainText(/Você já testou \d+ variaç/);
  await expect(page.getByLabel('Avisos sobre os dados')).toContainText('DADOS SIMULADOS');
  const bench = page.getByTestId('lab-benchmarks');
  await expect(bench).toContainText(/Estratégia \(após custos( e IR)?\)/);
  await expect(bench).toContainText('CDI no mesmo período');
  await expect(bench).toContainText(/\d+,\d%|sem dados do Banco Central/);
  await expect(page.getByTestId('lab-kpis')).toContainText('Taxa de acerto');

  // gráficos com dica ao tocar
  await expect(page.getByTestId('equity-chart').locator('svg')).toBeVisible();
  const hist = page.getByTestId('r-histogram');
  await expect(hist.locator('svg')).toBeVisible();
  const svg = hist.locator('svg');
  await svg.scrollIntoViewIfNeeded();
  const box = (await svg.boundingBox())!;
  await svg.hover({ position: { x: box.width * 0.35, y: box.height / 2 } });
  await expect(hist.getByRole('status')).toContainText(/trades?/);

  // a tentativa fica registrada
  await expect(page.getByText(/Testes anteriores \(\d+\)/)).toBeVisible();
});
