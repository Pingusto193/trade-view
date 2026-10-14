import { expect, test } from '@playwright/test';

test('replay sorteado: avança candle a candle, compra, encerra, revela o ativo e mostra o feedback', async ({
  page,
}) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/replay');
  await page.getByRole('button', { name: 'Sortear ativo e data' }).click();
  // o sorteio pode cair no BTC simulado (~60 mil por unidade): capital grande para caber 1 unidade
  await page.getByLabel('Capital fictício').fill('100000000');
  await page.getByRole('button', { name: 'Começar' }).click();

  await expect(page.getByTestId('replay-symbol')).toHaveText('Ativo sorteado');
  await expect(page.getByTestId('replay-progress')).toContainText('candle 0 de');
  // datas escondidas: a legenda não mostra a data do candle
  await expect(page.getByTestId('chart-canvas')).toBeVisible();
  await expect(page.getByTestId('legend-time')).toHaveCount(0);

  await page.getByRole('button', { name: 'Próximo candle ▶' }).click();
  await expect(page.getByTestId('replay-progress')).toContainText('candle 1 de');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('replay-progress')).toContainText('candle 2 de');

  // último fechamento revelado (pela API: o servidor só entrega o que já foi revelado)
  const { id, last } = await page.evaluate(async () => {
    const s = (await (await fetch('/api/replay/sessions')).json()) as {
      sessions: { id: string; status: string }[];
    };
    const sid = s.sessions.find((x) => x.status === 'ativa')!.id;
    const v = (await (await fetch(`/api/replay/sessions/${sid}`)).json()) as {
      candles: { close: number }[];
    };
    return { id: sid, last: v.candles.at(-1)!.close };
  });
  const ticket = page.getByRole('region', { name: 'Boleta do replay' });
  await ticket.getByLabel('Stop', { exact: true }).fill(String(+(last * 0.9).toFixed(2)));
  await ticket.getByLabel('Alvo', { exact: true }).fill(String(+(last * 1.3).toFixed(2)));
  await ticket.getByRole('button', { name: 'Comprar' }).click();
  await expect(ticket.getByText('executa na abertura do próximo candle')).toBeVisible();
  await page.getByRole('button', { name: 'Próximo candle ▶' }).click();
  await expect(page.getByTestId('replay-position')).toBeVisible();

  await page.getByRole('button', { name: 'Encerrar e revelar' }).click();
  await expect(page.getByTestId('replay-ended')).toContainText('O ativo era SIM');
  await expect(page.getByTestId('replay-symbol')).not.toHaveText('Ativo sorteado');
  const trade = page.getByTestId('replay-trade').first();
  await trade.getByRole('button', { name: 'Ver feedback' }).click();
  await expect(trade.getByTestId('feedback-compare')).toBeVisible();

  await page.evaluate(
    (sid) =>
      fetch(`/api/replay/sessions/${sid}`, {
        method: 'DELETE',
        headers: { 'x-radar-client': 'e2e' },
      }),
    id,
  );
});
