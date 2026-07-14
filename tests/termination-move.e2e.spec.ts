import { test, expect, Page } from '@playwright/test';

/**
 * Termination-move e2e — verifies Termination was moved OFF the home app grid
 * and INTO the HR dashboard (admin-only). Runs against staging via the `modules`
 * project (self-login, mobile viewport). Manager creds fall back to the staging
 * test account; the admin case auto-skips unless admin creds are provided:
 *   SMOKE_MANAGER_EMAIL / SMOKE_MANAGER_PASSWORD
 *   SMOKE_ADMIN_EMAIL   / SMOKE_ADMIN_PASSWORD   (or SMOKE_EMAIL / SMOKE_PASSWORD)
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const ADMIN = {
  email: process.env.SMOKE_ADMIN_EMAIL || process.env.SMOKE_EMAIL || '',
  password: process.env.SMOKE_ADMIN_PASSWORD || process.env.SMOKE_PASSWORD || '',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('manager: Termination gone from home grid, and hidden in HR (admin-only)', async ({ page }) => {
  await login(page, MGR.email, MGR.password);

  // Home app grid loaded, but no Termination tile.
  await page.goto('/');
  await expect(page.getByText('Apps')).toBeVisible();
  await expect(page.getByText('Profile & onboarding')).toBeVisible(); // HR tile subtitle => grid rendered
  await expect(page.getByText('Termination', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Letters & offboarding')).toHaveCount(0);

  // HR dashboard renders; a non-admin manager must NOT see the Termination tile.
  await page.goto('/hr');
  await expect(page.getByText('Manager Tools')).toBeVisible();
  await expect(page.getByText('Employees', { exact: true })).toBeVisible();
  await expect(page.getByText('Termination', { exact: true })).toHaveCount(0);
});

test('admin: Termination lives in HR and opens the termination flow', async ({ page }) => {
  test.skip(!ADMIN.email || !ADMIN.password, 'admin creds not set (SMOKE_ADMIN_EMAIL/PASSWORD)');
  await login(page, ADMIN.email, ADMIN.password);

  // Still gone from the home grid for admins too.
  await page.goto('/');
  await expect(page.getByText('Apps')).toBeVisible();
  await expect(page.getByText('Termination', { exact: true })).toHaveCount(0);

  // Present in HR Manager Tools, and tapping it opens /termination.
  await page.goto('/hr');
  await expect(page.getByText('Manager Tools')).toBeVisible();
  const term = page.locator('button', { hasText: 'Termination' }).first();
  await expect(term).toBeVisible();
  await expect(page.getByText('Letters & offboarding')).toBeVisible();
  await term.click();
  await page.waitForURL(/\/termination/, { timeout: 20_000 });
});
