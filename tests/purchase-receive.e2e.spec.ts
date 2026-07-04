import { test, expect, type Page } from '@playwright/test';

// Staff credentials come from env (same convention as auth.setup.ts / inventory.e2e).
const STAFF_EMAIL = process.env.SMOKE_STAFF_EMAIL || process.env.SMOKE_EMAIL || '';
const STAFF_PASSWORD = process.env.SMOKE_STAFF_PASSWORD || process.env.SMOKE_PASSWORD || '';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

test('receive screen shows capture+submit and no OCR scan button', async ({ page }) => {
  test.skip(!STAFF_EMAIL, 'SMOKE_STAFF_EMAIL/PASSWORD not set');
  page.on('dialog', (d) => d.accept());
  await login(page, STAFF_EMAIL, STAFF_PASSWORD);

  await page.goto('/purchase');
  // Go to the Receive tab (bottom nav).
  await page.getByRole('button', { name: /receive/i }).first().click();

  // The removed OCR scan button must not exist anywhere.
  await expect(page.getByRole('button', { name: /scan delivery note/i })).toHaveCount(0);

  // If there is a pending delivery, open it and assert the new capture controls.
  const firstDelivery = page.getByTestId('delivery-row').first();
  if (await firstDelivery.count()) {
    await firstDelivery.click();
    await expect(page.getByText(/add delivery note photo/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /submit for approval/i })).toBeVisible();
  }
});
