import { expect, test as setup } from '@playwright/test';

// O app abre no modo simples (ADR-0029); os testes antigos usam as ferramentas do modo completo.
// O teste do modo simples troca e devolve.
setup('servidor de teste começa no modo completo', async ({ request }) => {
  const r = await request.put('/api/prefs', {
    data: { view: 'completo' },
    headers: { 'x-radar-client': 'e2e' },
  });
  expect(r.ok()).toBe(true);
});
