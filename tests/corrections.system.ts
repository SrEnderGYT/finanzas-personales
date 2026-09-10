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

test('two independent clients resolve a real 409 with immutable history and lost-response recovery', async ({
  page,
  context,
  browser,
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
  await page.locator('input[name=amount]').fill('0.10');
  await page.locator('input[name=date]').fill('2026-01-01');
  await page.getByRole('button', { name: 'Guardar pendiente', exact: true }).click();
  await page.locator('.sidebar').getByRole('link', { name: 'Movimientos', exact: true }).click();
  await expect(page.locator('[data-state=pending]')).toHaveCount(1);
  await context.setOffline(false);
  await expect(page.locator('[data-state=confirmed]')).toHaveCount(1);
  const secondContext = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const second = await secondContext.newPage();
    await second.goto(`${system.url}/#/acceso`);
    await second.getByLabel('Correo electrónico').fill(email);
    await second.getByLabel('Contraseña', { exact: true }).fill(password);
    await second.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(second.getByRole('heading', { name: 'Tu sesión', exact: true })).toBeVisible();
    await second.locator('.sidebar').getByRole('link', { name: 'Registrar movimiento' }).click();
    await second.getByRole('button', { name: 'Preparar perfil conectado' }).click();
    await second.getByLabel('Frase local').fill('Synthetic second client phrase');
    await second.getByRole('button', { name: 'Crear espacio cifrado' }).click();
    await second
      .locator('.sidebar')
      .getByRole('link', { name: 'Movimientos', exact: true })
      .click();
    await expect(second.locator('[data-state=confirmed]')).toHaveCount(1);
    for (const client of [page, second]) {
      await client.getByRole('button', { name: 'Corregir movimiento', exact: true }).click();
      await client
        .locator('input[name=correction-reason]')
        .fill('Corrección sintética entre clientes');
    }
    await page.locator('input[name=correction-amount]').fill('0.20');
    const applied = page.waitForResponse((r) => r.url().endsWith('/v1/sync/corrections'));
    await page.getByRole('button', { name: 'Confirmar corrección', exact: true }).click();
    expect((await applied).status()).toBe(200);
    await expect(page.locator('[data-state=confirmed]')).toContainText('PEN 0.20');
    await second.locator('input[name=correction-amount]').fill('0.30');
    const rejected = second.waitForResponse((r) => r.url().endsWith('/v1/sync/corrections'));
    await second.getByRole('button', { name: 'Confirmar corrección', exact: true }).click();
    expect((await rejected).status()).toBe(409);
    await expect(second.getByRole('heading', { name: 'Requiere revisión' })).toBeVisible();
    const conflict = second.getByRole('region', { name: 'Conflicto de movimiento' });
    await expect(conflict).toContainText('PEN 0.30');
    await expect(conflict).toContainText('PEN 0.20');
    await expect(conflict).toContainText('Campos diferentes: importe');
    for (const [width, height, theme, label] of [
      [1440, 1000, 'light', 'desktop'],
      [390, 844, 'light', 'mobile-light'],
      [390, 844, 'dark', 'mobile-dark'],
    ] as const) {
      await second.setViewportSize({ width, height });
      await second.emulateMedia({ colorScheme: theme });
      await second.screenshot({ path: `docs/evidence/P10/conflict-${label}.png`, fullPage: true });
    }
    await second.setViewportSize({ width: 1440, height: 1000 });
    let lost = false;
    await second.route('**/v1/sync/corrections', async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (!lost) {
        lost = true;
        await route.abort();
      } else await route.fulfill({ response });
    });
    await second
      .getByRole('button', {
        name: 'Revertir versión del servidor y registrar mi corrección',
        exact: true,
      })
      .click();
    await expect(
      second.getByRole('button', { name: 'Reintentar corrección', exact: true }),
    ).toBeVisible();
    await second.getByRole('button', { name: 'Reintentar corrección', exact: true }).click();
    await expect(second.locator('[data-state=confirmed]')).toContainText('PEN 0.30');
    await expect(second.getByRole('heading', { name: 'Requiere revisión' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sincronizar ahora', exact: true }).click();
    await expect(page.locator('[data-state=confirmed]')).toContainText('PEN 0.30');
    expect(lost).toBe(true);
    const balance = await page.request.get(`${system.url}/v1/accounts/${accountId}`, { headers });
    expect((await balance.json()).balance).toEqual({ currency: 'PEN', amountMinor: '-30' });
    const count = await system.admin.query(
      'SELECT count(*)::text n FROM app.manual_movements WHERE account_id=$1',
      [accountId],
    );
    expect(count.rows[0].n).toBe('3');
    const corrections = await system.admin.query(
      `SELECT count(*)::text n FROM app.manual_corrections r
      JOIN app.manual_movements m ON (m.user_id,m.id)=(r.user_id,r.root_id) WHERE m.account_id=$1`,
      [accountId],
    );
    expect(corrections.rows[0].n).toBe('2');
  } finally {
    await secondContext.close();
  }
});
