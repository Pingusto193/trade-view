import { expect, test } from '@playwright/test';

test('calculadora: quantidade pelo risco com lote e fracionário da B3', async ({ page }) => {
  await page.goto('/calculadora');
  const calc = page.getByRole('region', { name: 'Calculadora de posição' });
  await calc.getByLabel('Capital (R$)').fill('10000');
  await calc.getByLabel('Risco por trade (%)').fill('1');
  await calc.getByLabel('Entrada (BRL)').fill('38');
  await calc.getByLabel('Stop técnico (BRL)').fill('36');
  await calc.getByLabel('Alvo (opcional)').fill('42');
  const r = calc.getByTestId('calc-result');
  // R$ 100 de risco ÷ R$ 2 por ação = 50 ações (todas no fracionário)
  await expect(r).toContainText('50 ações');
  await expect(r).toContainText('0 lotes de 100 + 50 no fracionário');
  await expect(r).toContainText('2,00R');
  // mini-índice: R$ 0,20 por ponto → 200 pontos de stop = R$ 40 por contrato → 2 contratos
  await calc.getByLabel('Mercado').selectOption('b3-win');
  await calc.getByLabel('Entrada (BRL)').fill('130000');
  await calc.getByLabel('Stop técnico (BRL)').fill('129800');
  await calc.getByLabel('Alvo (opcional)').fill('');
  await expect(r).toContainText('2 contratos');
});

test('diário real: registra, parcial, stop para trás com confirmação, encerra e apaga', async ({
  page,
}) => {
  const sym = `TST${test.info().project.name.slice(0, 1).toUpperCase()}3`;
  page.on('dialog', (d) => void d.accept());
  await page.goto('/diario');
  await page.getByRole('button', { name: '+ Registrar trade' }).click();
  const form = page.getByRole('region', { name: 'Registrar trade real' });
  await form.getByRole('textbox', { name: /^Ativo/ }).fill(sym);
  await form.getByLabel('Preço de entrada (BRL)').fill('38');
  await form.getByLabel('Stop técnico (BRL)').fill('36');
  await form.getByLabel('Alvo (opcional)').fill('42');
  await form.getByLabel('Quantidade (ações)').fill('200');
  await form.getByLabel('Custos da entrada (R$)').fill('4');
  await expect(form.getByTestId('plan-status')).toContainText('Plano incompleto');
  await form.getByRole('button', { name: 'Registrar' }).click();

  const card = page.getByTestId('real-open').filter({ hasText: sym });
  await expect(card).toContainText('aberto: 200 a 38 BRL');
  await expect(card).toContainText('risco inicial R$ 400,00');

  // parcial
  await card.getByRole('button', { name: 'Registrar saída / parcial' }).click();
  const exit = card.getByLabel('Registrar saída');
  await exit.getByLabel(/Quantidade/).fill('100');
  await exit.getByLabel('Preço (BRL)').fill('40');
  await exit.getByRole('button', { name: 'Salvar saída' }).click();
  await expect(card).toContainText('aberto: 100');

  // afastar o stop pede confirmação (o diálogo é aceito) e fica registrado
  await card.getByRole('button', { name: 'Mover stop / alvo' }).click();
  await card.getByLabel('Stop (BRL)').fill('35');
  await card.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(card).toContainText('stop movido para trás');

  // encerra
  await card.getByRole('button', { name: 'Registrar saída / parcial' }).click();
  await card.getByLabel('Registrar saída').getByLabel('Preço (BRL)').fill('39');
  await card.getByLabel('Registrar saída').getByRole('button', { name: 'Salvar saída' }).click();
  const closed = page.getByTestId('real-closed').filter({ hasText: sym });
  await expect(closed).toBeVisible();
  // (40 − 38) × 100 + (39 − 38) × 100 − 4 = R$ 296 → 296 / 400 = 0,74R
  await expect(closed).toContainText('R$ 296,00');
  await expect(closed).toContainText('0,74R');
  await expect(closed).toContainText('stop movido para trás');

  // limpeza: apaga pelo servidor (o cartão fechado não tem botão de apagar)
  const id = await page.evaluate(async (s) => {
    const j = (await (await fetch('/api/real/journal')).json()) as {
      trades: { id: string; symbol: string }[];
    };
    return j.trades.find((t) => t.symbol === s)?.id ?? null;
  }, sym);
  expect(id).not.toBeNull();
  await page.evaluate(
    (i) =>
      fetch(`/api/real/trades/${i}`, { method: 'DELETE', headers: { 'x-radar-client': 'e2e' } }),
    id,
  );
});
