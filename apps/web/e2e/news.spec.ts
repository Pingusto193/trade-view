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

  // resumo por IA: sem a chave do Assistente não liga (e a fonte simulada não permite IA)
  await expect(feed.getByRole('button', { name: 'Resumir com IA' })).toHaveCount(0);
  await page.getByText('Resumo por IA', { exact: true }).click();
  const ai = page.getByTestId('news-ai-settings');
  await ai.getByRole('button', { name: 'Ligar resumo por IA' }).click();
  await expect(ai).toContainText(/chave da API/);
  await expect(ai).toContainText('Desligado');

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

  // estudo de evento do ativo: notícias do Radar contra um candle qualquer
  const study = panel.getByTestId('event-study');
  await study.getByRole('button', { name: 'Calcular estudo de evento' }).click();
  await expect(study).toContainText('Notícias do Radar', { timeout: 15_000 });
  await expect(study).toContainText('Régua (um candle qualquer)');
});
