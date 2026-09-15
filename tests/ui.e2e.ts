import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

test('mobile boots into login without a configured native API', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.locator('fp-shell')).toHaveCount(1);
  await expect(page).toHaveURL(/#\/acceso$/);
  await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toBeDisabled();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  expect(errors).toEqual([]);
});

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

test('PWA reopens offline into login without caching financial API responses', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'finanzas-pwa-'));
  let browser = await chromium.launchPersistentContext(profile);
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:4173/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(async () => !!(await caches.match(location.origin + '/index.html'))),
      )
      .toBe(true);
    await page.evaluate(async () => {
      await fetch('/v1/me');
    });
    const cachedUrls = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
      }
      return urls;
    });
    expect(cachedUrls.some((url) => url.includes('/v1/'))).toBe(false);
    await browser.close();
    browser = await chromium.launchPersistentContext(profile, { offline: true });
    const reopened = await browser.newPage();
    await reopened.goto('http://127.0.0.1:4173/');
    await expect(reopened.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
    await expect(reopened.locator('.sidebar')).toHaveCount(0);
    await expect(reopened.getByText(/DEMO/i)).toHaveCount(0);
    await reopened.getByRole('link', { name: 'Abrir espacio local sin conexión' }).click();
    await expect(
      reopened.getByRole('heading', { name: 'Tu espacio en este dispositivo' }),
    ).toBeVisible();
  } finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true });
  }
});
