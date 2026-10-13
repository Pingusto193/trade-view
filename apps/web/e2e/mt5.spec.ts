import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Agente MT5 pela tela: gera o token em Fontes de dados, um "agente" (o teste, falando o protocolo)
 * manda dados do simulador e o gráfico abre com a faixa DADOS SIMULADOS. O agente Python de verdade
 * é testado contra o servidor em apps/server/test/mt5-agent-e2e.test.ts.
 */
const day = 86_400;

function body(symbol: string, extra: Record<string, unknown> = {}) {
  return {
    protocol: 1,
    agent: {
      version: 'e2e',
      mode: 'simulated',
      terminalConnected: true,
      company: 'Simulador do agente Radar (DADOS SIMULADOS)',
      serverTz: 'UTC',
    },
    ...extra,
    symbols: [
      {
        name: symbol,
        description: `${symbol} (SIMULADO)`,
        currency_base: symbol.slice(0, 3),
        currency_profit: symbol.slice(3),
        digits: 5,
        point: 0.00001,
        trade_tick_size: 0.00001,
        trade_tick_value: 1,
        trade_contract_size: 100000,
        volume_min: 0.01,
        volume_step: 0.01,
        trade_calc_mode: 0,
      },
    ],
  };
}

/** Faz o papel do agente por alguns segundos: responde aos pedidos de histórico. */
async function serve(request: APIRequestContext, token: string, symbol: string, ms: number) {
  const end = Date.now() + ms;
  const today = Math.floor(Date.now() / 1000 / day) * day;
  let pending: { symbol: string; tf: string; count: number }[] = [];
  while (Date.now() < end) {
    const bars = pending.map((h) => ({
      symbol: h.symbol,
      tf: h.tf,
      history: true,
      rates: Array.from({ length: 120 }, (_, i) => {
        const step = h.tf === '1d' ? day : 60 * Number(h.tf.replace(/\D/g, '') || 1);
        const t =
          (h.tf === '1d' ? today : Math.floor(Date.now() / 1000 / step) * step) - (119 - i) * step;
        const c = 1.08 + 0.01 * Math.sin(i / 7);
        return [t, c, c + 0.001, c - 0.001, c, 100 + i, 1, 0];
      }),
    }));
    const r = await request.post('/api/mt5/ingest', {
      headers: { authorization: `Bearer ${token}` },
      data: body(symbol, { bars }),
    });
    expect(r.status()).toBe(200);
    pending = (await r.json()).history;
    await new Promise((res) => setTimeout(res, 300));
  }
}

test('gera o token do agente MT5 e o simulador alimenta o gráfico com a faixa DADOS SIMULADOS', async ({
  page,
  request,
}, info) => {
  const symbol = info.project.name === 'iphone' ? 'GBPUSD' : 'EURUSD';
  await page.goto('/fontes');
  const panel = page.getByTestId('mt5-panel');
  await expect(panel).toContainText('só lê dados');
  await panel.getByLabel('Nome do agente').fill(`PC de teste ${info.project.name}`);
  await panel.getByRole('button', { name: 'Gerar token para um agente' }).click();
  const box = page.getByTestId('mt5-token');
  await expect(box).toContainText('aparece só esta vez');
  const token = /token = (\S+)/.exec(await box.locator('pre').innerText())?.[1] ?? '';
  expect(token).toMatch(/^rmt5_/);

  // primeiro contato do "agente": anuncia o ativo
  await serve(request, token, symbol, 500);
  await page.reload();
  await expect(
    page.getByTestId('mt5-agent').filter({ hasText: `PC de teste ${info.project.name}` }),
  ).toContainText('Conectado — SIMULADOR');

  // o gráfico pede o histórico ao agente; o teste responde enquanto a página carrega
  const serving = serve(request, token, symbol, 6_000);
  await page.goto(`/grafico?id=mt5sim:${symbol}&tf=1d`);
  await expect(page.getByText('DADOS SIMULADOS — não representam nenhum mercado real')).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  await expect(page.getByRole('button', { name: 'Detalhes da fonte de dados' })).toContainText(
    'MT5 simulado',
  );
  await serving;
});
