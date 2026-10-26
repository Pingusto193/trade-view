import { expect, test } from '@playwright/test';

test('notícias: feed com a fonte simulada, saúde da fonte e aba no gráfico com filtro pelo ativo', async ({
  page,
}) => {
  await page.goto('/noticias');
  await page
    .getByRole('group', { name: 'Filtro de notícias' })
    .getByRole('button', { name: 'Tudo' })
    .click();
  const feed = page.getByRole('region', { name: 'Feed de notícias' });
  // a primeira leitura da fonte simulada acontece ~2 s depois de o servidor ligar
  await expect(feed.getByRole('link', { name: /\[SIMULADO\]/ }).first()).toBeVisible({
    timeout: 20_000,
  });
  // o título leva à matéria original em outra aba
  const link = feed.getByRole('link', { name: /\[SIMULADO\]/ }).first();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);

  await page.getByText('Fontes e atraso medido').click();
  const sources = page.getByTestId('news-sources');
  await expect(sources).toContainText('Notícias SIMULADAS');
  await expect(sources).toContainText(/ok |aguardando/);

  // aba Notícias no gráfico: só as do ativo aberto
  await page.goto('/grafico?id=sim:SIMBTC&tf=1m');
  await page.getByRole('button', { name: 'Notícias deste ativo' }).click();
  const panel = page.getByRole('complementary', { name: 'Notícias' });
  await expect(panel.getByRole('link', { name: /SIMBTC/ }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(panel.getByRole('link', { name: /SIMACAO divulga/ })).toHaveCount(0);
});
