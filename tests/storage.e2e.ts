import { test, expect, chromium } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('encrypted prototype survives closing browser and reopening offline', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'finanzas-synthetic-e2e-'));
  let context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    let page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/#/configuracion');
    await page
      .getByLabel('Frase local de prueba (mínimo 12 caracteres)')
      .fill('frase sintética de prueba');
    await page.getByRole('button', { name: 'Crear bóveda de prueba' }).click();
    await expect(page.getByRole('button', { name: 'Bloquear bóveda', exact: true })).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.getByLabel('Importe ficticio en PEN').fill('67.50');
    await page.getByRole('button', { name: 'Guardar prueba cifrada' }).click();
    await expect(page.getByRole('heading', { name: 'Pendientes locales: 1' })).toBeVisible();
    await page.screenshot({ path: 'docs/evidence/P03/encrypted-offline.png', fullPage: true });
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 390, height: 844 },
    });
    await context.setOffline(true);
    page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/#/configuracion');
    await expect(
      page.getByRole('button', { name: 'Desbloquear bóveda', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('S/ 67.50', { exact: true })).not.toBeVisible();
    await page
      .getByLabel('Frase local de prueba (mínimo 12 caracteres)')
      .fill('frase sintética de prueba');
    await page.getByRole('button', { name: 'Desbloquear bóveda', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pendientes locales: 1' })).toBeVisible();
    await expect(page.getByText('S/ 67.50', { exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('heading', { name: 'Pendientes locales: 1' })).toBeVisible();
    await page.screenshot({ path: 'docs/evidence/P03/reopened.png', fullPage: true });
  } finally {
    await context.close();
  }
});
