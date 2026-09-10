import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { authSystem } from './support/auth-system';
// Inject transport loss at the browser request boundary. PWA/offline-shell
// persistence remains covered by manual.e2e.ts with the real service worker.
test.use({ serviceWorkers: 'block' });
let system: Awaited<ReturnType<typeof authSystem>>;
test.beforeAll(async () => {
  system = await authSystem();
});
test.afterAll(async () => {
  await system?.close();
});

test('real product: offline expense, lost commit response, one journal, encrypted reopen', async ({
  page,
  context,
}) => {
  const email = `${randomUUID()}@example.test`,
    password = 'Synthetic sync browser password';
  await page.goto(`${system.url}/#/acceso`);
  await page.getByRole('button', { name: 'Crear una cuenta' }).click();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByRole('button', { name: 'Enviar código de verificación' }).click();
  await expect(page.getByRole('heading', { name: 'Confirma tu correo' })).toBeVisible();
  await page.getByLabel('Código del correo').fill(await system.mail(email, 'verify'));
  await page.getByLabel('Nueva contraseña').fill(password);
  await page.getByRole('button', { name: 'Verificar y crear contraseña' }).click();
  await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  const login = page.waitForResponse((r) => r.url().endsWith('/v1/auth/login'));
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const { token } = (await (await login).json()) as { token: string };
  await expect(page.getByRole('heading', { name: 'Tu sesión', exact: true })).toBeVisible();
  const headers = { authorization: `Bearer ${token}` },
    accountId = randomUUID(),
    categoryId = randomUUID();
  for (const [path, type, id, payload] of [
    [
      '/v1/accounts',
      'account.create',
      accountId,
      { name: 'Cuenta sintética', type: 'cash', currency: 'PEN', state: 'active', position: 0 },
    ],
    [
      '/v1/categories',
      'category.create',
      categoryId,
      { name: 'Categoría sintética', kind: 'expense', state: 'active', position: 0 },
    ],
  ] as const) {
    const result = await page.request.post(system.url + path, {
      headers,
      data: {
        operationId: randomUUID(),
        deviceId: randomUUID(),
        schemaVersion: 1,
        baseVersion: '0',
        command: { type, id, payload },
      },
    });
    expect(result.status()).toBe(201);
  }
  await page.locator('.sidebar').getByRole('link', { name: 'Registrar movimiento' }).click();
  await page.getByRole('button', { name: 'Preparar perfil conectado' }).click();
  await page.getByLabel('Frase local').fill('Synthetic browser vault phrase');
  await page.getByRole('button', { name: 'Crear espacio cifrado' }).click();
  await expect(page.locator('select[name=account] option')).toHaveCount(2);
  await expect(page.locator('.topbar')).not.toContainText('DEMO');
  await expect(page.locator('.sidebar')).not.toContainText('Espacio de prueba');
  await context.setOffline(true);
  await page.locator('select[name=account]').selectOption(accountId);
  await page.locator('select[name=category]').selectOption(categoryId);
  await page.locator('input[name=amount]').fill('0,10');
  await page.locator('input[name=date]').fill('2026-01-01');
  await page.locator('textarea[name=note]').fill('Registro sintético offline');
  await page.getByRole('button', { name: 'Guardar pendiente', exact: true }).click();
  await expect(page.locator('.pending-row')).toHaveCount(1);
  await page.locator('.sidebar').getByRole('link', { name: 'Movimientos', exact: true }).click();
  await expect(page.locator('[data-state=pending]')).toHaveCount(1);
  let sent = 0,
    recovered = false;
  await page.route('**/v1/sync/commands', async (route) => {
    const response = await route.fetch(); // Real server commits before the first response is discarded.
    const body = await response.json();
    sent++;
    if (sent === 1) {
      expect(body.status).toBe('applied');
      await route.abort();
    } else {
      expect(body.status).toBe('already_applied');
      recovered = true;
      await route.fulfill({ response });
    }
  });
  await page.route('**/v1/sync/changes**', async (route) => {
    if (sent === 1)
      await route.abort(); // Force receipt recovery through the command retry.
    else await route.continue();
  });
  await context.setOffline(false);
  await expect(page.locator('[data-state=confirmed]')).toHaveCount(1, { timeout: 20000 });
  expect(recovered).toBe(true);
  await expect(page.getByText('Al día', { exact: true })).toBeVisible();
  expect(sent).toBe(2);
  const balance = await page.request.get(`${system.url}/v1/accounts/${accountId}`, { headers });
  expect((await balance.json()).balance).toEqual({ currency: 'PEN', amountMinor: '-10' });
  expect(
    (
      await system.admin.query(
        'SELECT count(*) AS n FROM app.manual_movements WHERE account_id=$1',
        [accountId],
      )
    ).rows[0].n,
  ).toBe('1');
  for (const [width, height, theme, label] of [
    [1440, 1000, 'light', 'desktop'],
    [390, 844, 'light', 'mobile-light'],
    [390, 844, 'dark', 'mobile-dark'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: `docs/evidence/P09/product-${label}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.unrouteAll({ behavior: 'wait' });
  await page.reload(); // No token is persisted; local unlock does not revive server authentication.
  await page.locator('.sidebar').getByRole('link', { name: 'Registrar movimiento' }).click();
  await page.getByRole('button', { name: /Perfil local/ }).click();
  await page.getByLabel('Frase local').fill('Synthetic browser vault phrase');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Desbloquear', exact: true }).click();
  await expect(page.locator('.pending-row')).toHaveCount(1);
  await page.locator('.sidebar').getByRole('link', { name: 'Movimientos', exact: true }).click();
  await expect(page.locator('[data-state=confirmed]')).toHaveCount(1);
  await expect(page.getByText('2026-01-01 · America/Lima', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Inicia sesión para sincronizar', { exact: true })).toBeVisible();
});
