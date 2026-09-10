import { test, expect, chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('manual form validates date, preserves entries and switches income currency explicitly', async ({
  page,
}) => {
  await page.goto('/#/registro');
  await page.getByRole('button', { name: 'Probar con datos DEMO' }).click();
  await page.locator('[name=credential]').fill('frase sintética de prueba');
  await page.getByRole('button', { name: 'Crear espacio cifrado' }).click();
  await expect(page.locator('[name=amount]')).toBeVisible();
  await page.getByRole('button', { name: 'Ingreso', exact: true }).click();
  await page.locator('[name=account]').selectOption({ label: 'Cuenta USD DEMO · USD' });
  await page.locator('[name=category]').selectOption({ label: 'Sueldo DEMO' });
  await page.locator('[name=amount]').fill('0.20');
  await page.locator('[name=date]').fill('');
  await page.locator('[name=note]').fill('Synthetic income');
  await page.getByRole('button', { name: 'Guardar pendiente' }).click();
  await expect(page.locator('.pending-row')).toHaveCount(0);
  await expect(page.locator('[name=amount]')).toHaveValue('0.20');
  await expect(page.locator('[name=note]')).toHaveValue('Synthetic income');
  await page.locator('[name=date]').fill('2026-01-01');
  await page.getByRole('button', { name: 'Guardar pendiente' }).click();
  await expect(page.locator('.pending-row')).toContainText('Ingreso · USD 0.20');
  await page.getByRole('button', { name: 'Gasto', exact: true }).click();
  await expect(page.locator('[name=category]')).toHaveValue('');
  await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
  await expect(page.locator('.pending-row')).toHaveCount(0);
});

test('manual pending survives browser termination offline and reconnect never confirms', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'manual-synthetic-'));
  let context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1440, height: 1000 },
  });
  try {
    let page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/#/registro');
    await page.getByRole('button', { name: 'Probar con datos DEMO' }).click();
    await page.locator('[name=credential]').fill('frase sintética de prueba');
    await page.getByRole('button', { name: 'Crear espacio cifrado' }).click();
    await expect(page.locator('[name=amount]')).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.locator('[name=account]').selectOption({ label: 'Efectivo DEMO · PEN' });
    await page.locator('[name=category]').selectOption({ label: 'Alimentación DEMO' });
    await page.locator('[name=amount]').fill('0,10');
    await page.locator('[name=date]').fill('2026-01-01');
    await page.locator('[name=note]').fill('Prueba sintética offline');
    await page.getByRole('button', { name: 'Guardar pendiente' }).click();
    await expect(page.locator('.pending-row')).toHaveCount(1);
    await expect(page.locator('.pending-row')).toContainText('PEN 0.10');
    await expect(page.locator('.pending-row')).toContainText('2026-01-01 · America/Lima');
    await expect(page.locator('.manual-feedback')).toContainText('Pendiente de envío');
    expect((await new AxeBuilder({ page }).include('.manual-page').analyze()).violations).toEqual(
      [],
    );
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: 'docs/evidence/P08/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'docs/evidence/P08/mobile-light.png', fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await expect(page.locator('.manual-card').first()).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    await page.screenshot({ path: 'docs/evidence/P08/mobile-dark.png', fullPage: true });
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 390, height: 844 },
    });
    await context.setOffline(true);
    page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/#/registro');
    await expect(page.locator('.pending-row')).toHaveCount(0);
    await page.getByRole('button', { name: 'Probar con datos DEMO' }).click();
    await page.locator('[name=credential]').fill('frase sintética de prueba');
    await page.getByRole('button', { name: 'Desbloquear', exact: true }).click();
    await expect(page.locator('.pending-row')).toHaveCount(1);
    await expect(page.locator('.pending-row')).toContainText('2026-01-01 · America/Lima');
    await context.setOffline(false);
    await expect(page.locator('.pending-badge')).toHaveText('Pendiente local');
    await page.screenshot({ path: 'docs/evidence/P08/reopened-offline.png', fullPage: true });
  } finally {
    await context.close();
  }
});
