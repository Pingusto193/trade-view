import { expect, test } from '@playwright/test';

test('assistente: desligado por padrão, chave mascarada e painel mostra o que vai ser enviado', async ({
  page,
}) => {
  await page.goto('/conta');
  const box = page.getByRole('region', { name: 'Assistente com IA' });
  await expect(box.getByText('(nenhuma guardada)')).toBeVisible();
  await expect(box.getByLabel('Ligado')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Perguntar ao assistente' })).toHaveCount(0);

  // modelo vazio e depois sem chave: recusado com mensagem clara
  await box.getByLabel('Modelo').fill('');
  await box.getByRole('button', { name: 'Salvar' }).click();
  await expect(box.getByRole('alert')).toContainText('Informe o modelo');
  await box.getByLabel('Modelo').fill('claude-opus-5-5');
  await box.getByLabel('Ligado').check();
  await box.getByRole('button', { name: 'Salvar' }).click();
  await expect(box.getByRole('alert')).toContainText('chave da API');

  await box.getByLabel(/Chave da API/).fill('sk-ant-teste-e2e-1234');
  await box.getByLabel('Preço entrada (US$/milhão de tokens)').fill('4');
  await box.getByLabel('Preço saída (US$/milhão de tokens)').fill('20');
  await box.getByRole('button', { name: 'Salvar' }).click();
  await expect(box.getByRole('status')).toHaveText('Salvo.');
  await expect(box.getByText('(guardada: …1234)')).toBeVisible();
  await expect(box.getByLabel(/Chave da API/)).toHaveValue('');
  const settings = await page.evaluate(() =>
    fetch('/api/assistant/settings').then((r) => r.text()),
  );
  expect(settings).not.toContain('sk-ant');

  // botão no topo abre o painel com o resumo da tela à vista
  await page.getByRole('button', { name: 'Perguntar ao assistente' }).click();
  const panel = page.getByRole('dialog', { name: 'Assistente' });
  await panel.getByText('O que vai junto com a pergunta').click();
  await expect(panel.getByTestId('assistant-context')).toContainText('riscoPorTradePct');
  await expect(panel.getByRole('button', { name: 'Perguntar' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Fechar' }).click();

  // apagar a chave desliga
  await box.getByRole('button', { name: 'Apagar chave' }).click();
  await expect(box.getByText('(nenhuma guardada)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Perguntar ao assistente' })).toHaveCount(0);
});
