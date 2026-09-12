import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('root is login-first and exposes no synthetic financial workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page).toHaveURL(/#\/acceso$/);
  await expect(page.getByRole('heading', { name: 'Un lugar para tenerlo claro.' })).toBeVisible();
  await expect(page.getByText('Servidor de Finanzas no conectado')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toBeDisabled();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Navegación móvil' })).toHaveCount(0);
  await expect(page.getByText(/DEMO/i)).toHaveCount(0);
});

test('private finance routes cannot be opened without an authenticated session', async ({
  page,
}) => {
  for (const path of [
    'inicio',
    'movimientos',
    'registro',
    'cuentas',
    'gmail',
    'tarjetas',
    'suscripciones',
    'deudas',
    'presupuestos',
    'analisis',
    'configuracion',
  ]) {
    await page.goto(`/#/${path}`);
    await expect(page).toHaveURL(/#\/acceso$/);
    await expect(page.getByRole('heading', { name: 'Un lugar para tenerlo claro.' })).toBeVisible();
  }
});

test('login-first surface is responsive and WCAG AA in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Un lugar para tenerlo claro.' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  }
});

test('PWA shell preserves the protected entry surface offline', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Un lugar para tenerlo claro.' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Un lugar para tenerlo claro.' })).toBeVisible();
  await context.setOffline(false);
});
