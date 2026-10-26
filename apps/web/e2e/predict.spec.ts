import { expect, test } from '@playwright/test';

test('previsão: probabilidade com histórico de acerto, réguas e placar ao vivo', async ({
  page,
}) => {
  await page.goto('/grafico?id=sim:SIMBTC&tf=1d');
  await page.getByRole('button', { name: 'Previsão deste ativo' }).click();
  const panel = page.getByTestId('predict-panel');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  const head = panel.getByTestId('predict-headline');
  // dados simulados (passeio aleatório): o honesto é não achar vantagem
  await expect(head).toContainText('SEM VANTAGEM COMPROVADA');
  await expect(panel.getByTestId('predict-confidence')).toContainText('placar ao vivo');
  // taxas-base com n e Wilson, e as três réguas
  await expect(panel.getByRole('region', { name: 'Taxas-base' })).toContainText(
    'Mesma tendência nas 3 escalas',
  );
  const hist = panel.getByRole('region', { name: 'Histórico de acerto' });
  await expect(hist).toContainText('Moeda (50%)');
  await expect(hist).toContainText('Sempre sobe');
  await expect(hist).toContainText('Persistência');
  // trocar o horizonte
  await panel.getByRole('button', { name: '1 candle', exact: true }).click();
  await expect(head).toContainText('1 candle');

  // acompanhar no placar e ver na página do placar
  await panel.getByRole('button', { name: 'Acompanhar no placar' }).click();
  await expect(panel.getByText('✓ Acompanhado no placar')).toBeVisible();
  await page.goto('/placar');
  const followed = page.getByRole('region', { name: 'Ativos acompanhados' });
  await expect(followed.getByRole('link', { name: /SIMBTC/ })).toBeVisible();
  await followed.getByRole('button', { name: /Parar de acompanhar SIMBTC/ }).click();
  await expect(followed.getByRole('link', { name: /SIMBTC/ })).toHaveCount(0);
});
