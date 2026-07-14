import { test, expect, Page } from '@playwright/test';

/**
 * Inventory module e2e — drives the real screens in a browser against staging.
 * Logs in itself (manager + shared tablet). Creds come from env with a fallback
 * to the staging test accounts, so `npm run test:inventory` works out of the box.
 *   SMOKE_MANAGER_EMAIL / SMOKE_MANAGER_PASSWORD
 *   SMOKE_TABLET_EMAIL  / SMOKE_TABLET_PASSWORD
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const TAB = {
  email: process.env.SMOKE_TABLET_EMAIL || 'waj-kitchen@krawings.de',
  password: process.env.SMOKE_TABLET_PASSWORD || 'WajKitchen#2026',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}
// dashboard tile = the real <button> inside the sortable wrapper (avoids the div[role=button])
const tile = (page: Page, label: string) => page.locator('button', { hasText: label }).first();

test('manager: Consumption report shows usage, Product Settings shows count-by', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await page.goto('/inventory');

  await tile(page, 'Consumption').click();
  await expect(page.getByRole('heading', { name: /^Consumption$/ })).toBeVisible();

  const dates = page.locator('input[type="date"]');
  await expect(dates).toHaveCount(2);
  await dates.nth(0).fill('2026-06-01');
  await dates.nth(1).fill('2026-06-30');

  await expect(page.getByText(/\d+\s+ingredients?\s+used/i)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('kg').first()).toBeVisible();

  await page.goto('/inventory');
  await tile(page, 'Product settings').click();
  await expect(page.getByText('Count by').first()).toBeVisible({ timeout: 25_000 });
});

test('tablet: crate count sheet opens from a count list', async ({ page }) => {
  await login(page, TAB.email, TAB.password);
  await page.goto('/inventory');

  await tile(page, 'My Lists').click();
  await expect(page.getByText('Drinks stocktake').first()).toBeVisible({ timeout: 25_000 });
  await page.getByText('Drinks stocktake').first().click();

  await expect(page.getByText(/1\s+crate\s*=\s*\d+/i).first()).toBeVisible({ timeout: 25_000 });

  await page.locator('button', { hasText: /Count\s*→/ }).first().click();
  await expect(page.getByText(/Full crates/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Loose/i).first()).toBeVisible();
});

test('manager: new count list offers Daily/Weekly/Ad-hoc, not the broken Monthly', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await page.goto('/inventory');

  await tile(page, 'Manage Lists').click();
  await page.getByRole('button', { name: /New counting list/i }).click();

  await expect(page.getByRole('button', { name: 'Weekly' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Daily' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ad-hoc' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Monthly' })).toHaveCount(0);
});
