import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('public entry never exposes a fake login or private navigation without an API', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/v1/auth/')) requests++;
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/acceso');
  await expect(page.getByRole('heading', { name: 'Tu información empieza con tu cuenta.' })).toBeVisible();
  await expect(page.getByText('Servidor de Finanzas no configurado')).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('http://127.0.0.1:4174/#/acceso');
    await expect(page.getByRole('heading', { name: 'Tu información empieza con tu cuenta.' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(audit.violations.map((entry) => entry.id)).toEqual([]);
  }
  expect(requests).toBe(0);
});

// Contract-level browser test. PostgreSQL authority is exercised separately in integration CI.
test.describe('auth contract without service worker interception', () => {
  test.use({ serviceWorkers: 'block' });
  test.beforeEach(async ({ page }) => {
    await page.route(/^http:\/\/127\.0\.0\.1:4173\/(\?.*)?$/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace('content="disabled"', 'content="same-origin"'),
      });
    });
  });
  test('enabled forms call auth API, clear passwords and recover from revoked sessions', async ({ page }) => {
    const calls: string[] = [];
    await page.route('**/v1/auth/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      calls.push(path);
      const body = path.endsWith('/login') ? { token: `fp_${'a'.repeat(43)}` } : [];
      if (path.endsWith('/sessions') && calls.filter((entry) => entry.endsWith('/sessions')).length > 1) {
        await route.fulfill({ status: 401, json: {} });
      } else await route.fulfill({ status: 200, json: body });
    });
    await page.goto('/#/acceso');
    await page.getByLabel('Correo electrónico').fill('synthetic@example.test');
    await page.getByLabel('Contraseña', { exact: true }).fill('Synthetic phrase for tests');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu sesión', exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain('fp_');
    await page.getByRole('button', { name: 'Actualizar sesiones' }).click();
    await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    await expect(page.getByRole('status').filter({ hasText: 'sesión ha caducado' })).toBeVisible();
    expect(calls).toEqual(['/v1/auth/login', '/v1/auth/sessions', '/v1/auth/sessions']);
  });
  test('verification and recovery choose passwords only after receiving a code', async ({ page }) => {
    const calls: string[] = [];
    await page.route('**/v1/auth/**', async (route) => {
      calls.push(new URL(route.request().url()).pathname);
      await route.fulfill({ status: 200, json: {} });
    });
    await page.goto('/#/acceso');
    for (const recovery of [false, true]) {
      await page.getByRole('button', { name: recovery ? 'Olvidé mi contraseña' : 'Crear una cuenta' }).click();
      await expect(page.locator('#auth-password')).toHaveCount(0);
      await page.getByLabel('Correo electrónico').fill('synthetic@example.test');
      await page
        .getByRole('button', {
          name: recovery ? 'Enviar código de recuperación' : 'Enviar código de verificación',
        })
        .click();
      await page.getByLabel('Código del correo').fill('a'.repeat(43));
      await page.getByLabel('Nueva contraseña').fill('Synthetic phrase for tests');
      await page
        .getByRole('button', {
          name: recovery ? 'Cambiar contraseña' : 'Verificar y crear contraseña',
        })
        .click();
      await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
      await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    }
    expect(calls).toEqual([
      '/v1/auth/register',
      '/v1/auth/verify-email',
      '/v1/auth/forgot-password',
      '/v1/auth/reset-password',
    ]);
  });
  test('Google callback removes code and state from the URL before completing access', async ({ page }) => {
    let completed = false;
    await page.route('**/v1/auth/**', async (route) => {
      if (route.request().url().endsWith('/google/complete')) {
        expect(new URL(page.url()).search).toBe('');
        expect(route.request().postDataJSON()).toEqual({
          state: 'synthetic-state',
          code: 'synthetic-code',
        });
        completed = true;
        await route.fulfill({ status: 200, json: { token: `fp_${'b'.repeat(43)}` } });
      } else await route.fulfill({ status: 200, json: [] });
    });
    await page.goto('/?state=synthetic-state&code=synthetic-code');
    await expect(page.getByRole('heading', { name: 'Tu sesión', exact: true })).toBeVisible();
    expect(completed).toBe(true);
    expect(page.url()).toBe('http://127.0.0.1:4173/#/acceso');
  });
});
