import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('conta: baixa todos os dados em JSON e importa o mesmo arquivo de volta', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/conta');
  const box = page.getByRole('region', { name: 'Seus dados' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    box.getByRole('link', { name: 'Baixar todos os meus dados' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^radar-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const file = JSON.parse(readFileSync(path, 'utf8')) as { format: string; tables: object };
  expect(file.format).toBe('radar-export');
  expect(file.tables).not.toHaveProperty('users');
  await box.locator('input[type=file]').setInputFiles(path);
  await expect(box.getByRole('status')).toContainText('Importado');
});
