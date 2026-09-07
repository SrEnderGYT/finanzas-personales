import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { authSystem } from './support/auth-system';

let system: Awaited<ReturnType<typeof authSystem>>;
const password = 'Synthetic initial phrase for browser tests';
const changed = 'Synthetic changed phrase for browser tests';
test.beforeAll(async () => {
  system = await authSystem();
});
test.afterAll(async () => {
  await system?.close();
});
test.beforeEach(async () => {
  await system.admin.query('DELETE FROM app.auth_rate_limits');
});

async function register(page: Page, email: string) {
  await page.goto(`${system.url}/#/acceso`);
  await page.getByRole('button', { name: 'Crear una cuenta' }).click();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByRole('button', { name: 'Enviar código de verificación' }).click();
  await expect(page.getByRole('heading', { name: 'Confirma tu correo' })).toBeVisible();
  await page.getByLabel('Código del correo').fill(await system.mail(email, 'verify'));
  await page.getByLabel('Nueva contraseña').fill(password);
  await page.getByRole('button', { name: 'Verificar y crear contraseña' }).click();
  await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
}
async function login(page: Page, email: string, secret = password) {
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(secret);
  const received = page.waitForResponse((response) => response.url().endsWith('/v1/auth/login'));
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const response = await received;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Tu sesión', exact: true })).toBeVisible();
  return response.json() as Promise<{ token: string; sessionId: string }>;
}

test('real browser registration, encrypted mail, recovery and revocation isolate users A and B', async ({
  browser,
  page,
}) => {
  const a = `${randomUUID()}@example.test`;
  const b = `${randomUUID()}@example.test`;
  const secondContext = await browser.newContext();
  const bContext = await browser.newContext();
  try {
    await register(page, a);
    const first = await login(page, a);
    const second = await secondContext.newPage();
    await second.goto(`${system.url}/#/acceso`);
    await login(second, a);
    const other = await bContext.newPage();
    await register(other, b);
    const otherSession = await login(other, b);
    await page.getByRole('button', { name: 'Actualizar sesiones' }).click();
    await expect(page.locator('.auth-sessions li')).toHaveCount(2);
    await expect(other.locator('.auth-sessions li')).toHaveCount(1);
    // A's actual UI-issued token cannot revoke B's actual UI-issued session.
    const foreign = await fetch(`${system.url}/v1/auth/sessions/${otherSession.sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${first.token}` },
    });
    expect(foreign.status).toBe(404);
    const recovery = await secondContext.newPage();
    await recovery.goto(`${system.url}/#/acceso`);
    await recovery.getByRole('button', { name: 'Olvidé mi contraseña' }).click();
    await recovery.getByLabel('Correo electrónico').fill(a);
    await recovery.getByRole('button', { name: 'Enviar código de recuperación' }).click();
    await expect(recovery.getByLabel('Código del correo')).toBeVisible();
    await recovery.getByLabel('Código del correo').fill(await system.mail(a, 'reset'));
    await recovery.getByLabel('Nueva contraseña').fill(changed);
    await recovery.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await expect(recovery.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
    for (const previous of [page, second]) {
      await previous.getByRole('button', { name: 'Actualizar sesiones' }).click();
      await expect(previous.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
    }
    await other.getByRole('button', { name: 'Actualizar sesiones' }).click();
    await expect(other.getByRole('heading', { name: 'Tu sesión', exact: true })).toBeVisible();
    await login(recovery, a, changed);
    await recovery.getByRole('button', { name: 'Cerrar todas las sesiones' }).click();
    await expect(recovery.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
    const rows = JSON.stringify(
      (await system.admin.query('SELECT envelope FROM app.auth_mail_outbox')).rows,
    );
    expect(rows.includes(a) || rows.includes(b) || rows.includes(password)).toBe(false);
    const logs = JSON.stringify(system.logs);
    expect(logs.includes(a) || logs.includes(password) || logs.includes(first.token)).toBe(false);
  } finally {
    await secondContext.close();
    await bContext.close();
  }
});

test('real PWA returns a connection error offline and can retry server-side logout online', async ({
  page,
  context,
}) => {
  const email = `${randomUUID()}@example.test`;
  await register(page, email);
  await login(page, email);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No pudimos conectar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tu sesión', exact: true })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
  await login(page, email);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage)),
  ).not.toContain('fp_');
});
