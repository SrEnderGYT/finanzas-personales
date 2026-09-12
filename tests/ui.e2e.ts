import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('desktop finance workspace filters and session movement are functional', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Mis finanzas', exact: true })).toBeVisible();
  await expect(page.getByTestId('public-expense')).toHaveText('S/ 386.00');

  await page.getByRole('button', { name: 'USD Dólares' }).click();
  await expect(page.getByTestId('public-expense')).toHaveText('US$ 24.00');

  await page.getByRole('button', { name: 'PEN Soles' }).click();
  await page.getByLabel('Rango financiero').selectOption('Hoy');
  await expect(page.getByTestId('public-expense')).toHaveText('S/ 186.50');
  await page.getByLabel('Rango financiero').selectOption('Este mes');

  await page.screenshot({ path: 'docs/evidence/P02/desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Nuevo movimiento' }).click();
  await page.getByLabel('Importe', { exact: true }).fill('12.50');
  await page.getByLabel('Comercio o concepto').fill('Compra de prueba');
  await page.getByRole('button', { name: 'Guardar en esta sesión' }).click();
  await expect(page.getByTestId('public-expense')).toHaveText('S/ 398.50');
  expect(errors).toEqual([]);
});

test('mobile has its own navigation, both themes and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('http://127.0.0.1:4174/');

  await expect(page.getByRole('navigation', { name: 'Navegación móvil' })).toBeVisible();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await page.getByRole('heading', { name: 'Próximos pagos', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Próximos pagos', exact: true })).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/evidence/P02/mobile-light.png', fullPage: true });

  await page.getByRole('link', { name: 'Perfil', exact: true }).click();
  await page.getByRole('button', { name: 'Oscuro', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Navegación móvil' })
    .getByRole('link', { name: 'Inicio', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'docs/evidence/P02/mobile-dark.png', fullPage: true });
});

test('visible finance workspace meets automated WCAG AA checks in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Mis finanzas', exact: true })).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  }
});

test('PWA shell survives offline reload', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mis finanzas', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mis finanzas', exact: true })).toBeVisible();
  await context.setOffline(false);
});
