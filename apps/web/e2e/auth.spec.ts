import { expect, test } from '@playwright/test';

const EMAIL = 'eu@exemplo.com';
const PW = 'uma-senha-bem-longa';

test('primeiro acesso cria a conta, sair e entrar de novo', async ({ page }) => {
  await page.goto('/grafico?id=sim:SIMBTC&tf=1d');
  await expect(page.getByText('Primeiro acesso: crie sua conta')).toBeVisible();
  // servidor público: a primeira conta exige o código de instalação (SETUP_CODE do servidor de teste)
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha', { exact: true }).fill(PW);
  await page.getByLabel('Repita a senha').fill(PW);
  await page.getByLabel('Código de instalação').fill('errado');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByText(/Código de instalação incorreto/)).toBeVisible();
  await page.getByLabel('Código de instalação').fill('codigo-e2e');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha', { exact: true }).fill(PW);
  await page.getByLabel('Repita a senha').fill(PW);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(
    page.getByText('DADOS SIMULADOS — não representam nenhum mercado real'),
  ).toBeVisible();

  await page.goto('/conta');
  await expect(page.getByText(`Conectado como ${EMAIL}`)).toBeVisible();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill('senha-errada-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible();

  await page.getByLabel('Senha').fill(PW);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Conectado como')).toBeVisible();
});
