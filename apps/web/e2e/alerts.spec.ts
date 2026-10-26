import { expect, test } from '@playwright/test';

test('criar alerta de preço pelo sino do gráfico', async ({ page }) => {
  await page.goto('/grafico?id=sim:SIMBTC&tf=1m');
  await page.getByRole('button', { name: 'Criar alerta' }).click();
  const form = page.getByRole('dialog', { name: 'Novo alerta' });
  await expect(form).toBeVisible();
  // o nível começa no último preço do ativo
  await expect
    .poll(async () => Number(await form.getByLabel('Preço').inputValue()))
    .toBeGreaterThan(1);
  await form.getByLabel('Nota').fill('teste e2e');
  await form.getByRole('button', { name: 'Criar alerta' }).click();
  await expect(form).toBeHidden();
  await page.goto('/alertas');
  await expect(page.getByText(/SIMBTC · 1 min · Preço cruzar para cima/).first()).toBeVisible();
  await expect(page.getByText('“teste e2e”').first()).toBeVisible();
});

test('alerta no toque dispara com os dados simulados e aparece no histórico', async ({ page }) => {
  test.setTimeout(90_000);
  // preço AO VIVO (o mesmo fluxo que o servidor de alertas recebe): o do /api/candles pode estar
  // longe dele, porque o simulador ao vivo segue o próprio passeio depois de assinado
  await page.goto('/grafico?id=sim:SIMBTC&tf=1m');
  const close = page.getByTestId('legend-close');
  await expect(close).toBeVisible({ timeout: 15_000 });
  // espera as primeiras atualizações ao vivo (uma por segundo) substituírem o histórico
  await page.waitForTimeout(2_500);
  const last = Number((await close.innerText()).replace(/\./g, '').replace(',', '.'));
  expect(last).toBeGreaterThan(1);
  // dois alertas colados no preço atual: o passeio aleatório toca um deles em segundos
  for (const [direction, k] of [
    ['up', 1.0001],
    ['down', 0.9999],
  ] as const) {
    const res = await page.request.post('/api/alerts', {
      data: {
        symbolId: 'sim:SIMBTC',
        tf: '1m',
        condition: { kind: 'price', level: last * k, direction },
        trigger: 'touch',
        channels: ['push'],
      },
    });
    expect(res.ok()).toBe(true);
  }
  await expect
    .poll(async () => (await (await page.request.get('/api/alerts/history')).json()).fires.length, {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
  await page.goto('/alertas?aba=historico');
  await expect(page.getByText(/Preço cruzou para (cima|baixo) o nível/).first()).toBeVisible();
  // sem aparelho ativado, o histórico mostra o motivo (nada é escondido)
  await expect(page.getByText(/nenhum aparelho ativado/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Abrir gráfico' }).first().click();
  await expect(page).toHaveURL(/\/grafico\?id=sim%3ASIMBTC&tf=1m/);
});

test('canais: guia do iPhone e teste de canal sem configuração', async ({ page }) => {
  await page.goto('/alertas?aba=canais');
  await expect(page.getByRole('region', { name: 'Notificações no iPhone' })).toBeVisible();
  await expect(page.getByText(/16\.4 ou mais novo/).first()).toBeVisible();
  const tg = page.getByRole('region', { name: 'Telegram' });
  await tg.getByRole('button', { name: 'Enviar teste' }).click();
  await expect(page.getByTestId('test-telegram')).toHaveText('erro: Telegram não configurado');
});
