import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', trace: 'off' });

// Browser contract only: the Google provider and API responses here are synthetic.
test('Google return opens enrollment in the original tab with its original session', async ({
  page,
  context,
}) => {
  const origin = 'http://127.0.0.1:4173';
  const token = `fp_${'a'.repeat(43)}`;
  const grant = `fpr_${'b'.repeat(43)}`;
  const calls: string[] = [];
  await context.route(/^http:\/\/127\.0\.0\.1:4173\/(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace('content="disabled"', 'content="same-origin"'),
    });
  });
  await context.route('https://accounts.google.com/**', (route) =>
    route.fulfill({
      status: 302,
      headers: { location: `${origin}/?state=synthetic-state&code=synthetic-code` },
      body: '',
    }),
  );
  await context.route('**/v1/auth/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push(path);
    if (path !== '/v1/auth/login')
      expect(request.headers()['authorization']).toBe(`Bearer ${token}`);
    let body: unknown = [];
    if (path.endsWith('/login')) body = { token };
    if (path.endsWith('/google/start')) {
      expect(request.postDataJSON()).toEqual({ mode: 'reauthenticate' });
      body = {
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-state',
      };
    }
    if (path.endsWith('/google/complete')) {
      expect(request.postDataJSON()).toEqual({ state: 'synthetic-state', code: 'synthetic-code' });
      body = { reauthenticated: true, grant };
    }
    if (path.endsWith('/mfa/enrollment/start')) {
      expect(request.postDataJSON()).toEqual({ grant });
      body = { secret: 'A'.repeat(32) };
    }
    await route.fulfill({ json: body });
  });
  await page.goto('/#/acceso');
  await page.getByLabel('Correo electrónico').fill('synthetic@example.test');
  await page
    .getByLabel('Contraseña', { exact: true })
    .fill('Synthetic phrase for browser contract');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Activar autenticador', exact: true }).click();
  await page.getByRole('button', { name: 'Verificar con Google vinculado' }).click();
  await expect(page.locator('.enrollment-secret')).toHaveText('A'.repeat(32));
  expect(page.url()).toBe(`${origin}/#/acceso`);
  expect(calls.filter((path) => path.endsWith('/google/complete'))).toHaveLength(1);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain(token);
  await expect.poll(() => context.pages().length).toBe(1);
});
