import { expect, test } from '@playwright/test';

test('modo treino: conta com dinheiro fictício escolhido, compra pelo gráfico, encerra e vê no diário', async ({
  page,
}) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/treino');
  await expect(page.getByTestId('train-banner')).toBeVisible();
  // primeira vez: cria a conta; nas próximas execuções a conta já existe
  const create = page.getByRole('button', { name: 'Criar conta' }).first();
  await expect(create).toBeVisible();
  if (await page.getByLabel('Conta de treino').count()) {
    await page.getByRole('combobox', { name: 'Conta de treino' }).waitFor();
  } else {
    await page.getByLabel('Dinheiro fictício inicial').fill('25000');
    await create.click();
  }
  const resumo = page.getByRole('region', { name: 'Resumo' });
  await expect(resumo).toBeVisible();

  // muda o dinheiro fictício (reinício guarda o histórico)
  await page.getByText('⚙ Conta, saldo e custos').click();
  await page.getByLabel('Novo saldo').fill('25000');
  await page.getByRole('button', { name: 'Reiniciar com este valor' }).click();
  await expect(resumo.getByText('R$ 25.000,00').first()).toBeVisible();

  // compra pelo gráfico, com preço real da fonte (aqui, o simulador de desenvolvimento)
  await page.goto('/grafico?id=sim:SIMACAO&tf=1d');
  await page.getByRole('button', { name: '🎯 Treino' }).click();
  const ticket = page.getByRole('dialog', { name: 'Boleta de treino' });
  await expect(ticket.getByText(/Último preço real: \d/)).toBeVisible();
  const lastText = await ticket.getByText(/Último preço real/).textContent();
  const last = Number(
    /Último preço real: ([\d.,]+)/
      .exec(lastText ?? '')![1]!
      .replace('.', '')
      .replace(',', '.'),
  );
  await ticket.getByLabel('Stop').fill((last * 0.9).toFixed(2));
  await ticket.getByLabel('Quantidade').fill('10');
  await ticket.getByRole('button', { name: 'Comprar no treino' }).click();
  await expect(ticket.getByTestId('ticket-msg')).toContainText('Executada');
  await ticket.getByRole('button', { name: 'Fechar' }).click();

  await page.goto('/treino');
  const posicoes = page.getByRole('region', { name: 'Posições abertas' });
  await expect(posicoes.getByText('SIMACAO')).toBeVisible();
  await posicoes.getByRole('button', { name: 'Encerrar' }).first().click();
  await expect(posicoes.getByText('SIMACAO')).toBeHidden({ timeout: 15_000 });
  const diario = page.getByRole('region', { name: 'Diário do treino' });
  await expect(diario.getByText('SIMACAO').first()).toBeVisible();
  // custos aparecem (o treino não pode parecer melhor do que o real)
  await expect(diario.getByText(/custos R\$ \d+,\d{2}/).first()).toBeVisible();
  await expect(diario.getByText('custos R$ 0,00')).toHaveCount(0);
});

test('chave Treino/Real: mudar para Real pede confirmação e tira a faixa', async ({ page }) => {
  await page.goto('/grafico?id=sim:SIMACAO&tf=1d');
  await expect(page.getByTestId('train-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Real', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Mudar para o modo Real' });
  await expect(dlg.getByText(/continua sem enviar ordens/)).toBeVisible();
  await dlg.getByRole('button', { name: 'Mudar para Real' }).click();
  await expect(page.getByTestId('train-banner')).toBeHidden();
  await expect(page.getByRole('button', { name: '🎯 Treino' })).toBeHidden();
  // volta para o treino (estado compartilhado com os outros testes)
  await page.getByRole('button', { name: 'Treino', exact: true }).click();
  await expect(page.getByTestId('train-banner')).toBeVisible();
});
