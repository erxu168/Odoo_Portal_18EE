import { test, expect, type Page } from '@playwright/test';

// Robot accounts (staging) — see CLAUDE.md; passwords come from .env.smoke.local.
const MANAGER = {
  email: process.env.SMOKE_MANAGER_EMAIL || process.env.WAJ_MANAGER_EMAIL || 'zz-e2e-robot-manager@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || process.env.WAJ_MANAGER_PW || process.env.SMOKE_PASSWORD || '',
};
const STAFF = {
  email: process.env.SMOKE_STAFF_EMAIL || process.env.WAJ_STAFF_EMAIL || 'zz-e2e-robot-staff@test.krawings.de',
  password: process.env.SMOKE_STAFF_PASSWORD || process.env.WAJ_STAFF_PW || '',
};

async function login(page: Page, u: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(u.email);
  await page.getByPlaceholder('Enter your password').fill(u.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

test('manager: tile home → Overview (Total sales excl. tips + separate tips) → ranges → Menu', async ({ page }) => {
  await login(page, MANAGER);
  await page.goto('/sales');
  await expect(page).toHaveURL(/\/sales/);

  // Tile home: the section tiles are the landing.
  await expect(page.getByRole('button', { name: /Overview/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.errbox')).toHaveCount(0);

  // Open the Overview section.
  await page.getByRole('button', { name: /Overview/ }).click();
  await expect(page.getByText('Total sales')).toBeVisible();

  // Month has tips → confirm Total sales renders AND tips show as a separate line.
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(page.getByText('Total sales')).toBeVisible();
  await expect(page.getByText(/in tips/)).toBeVisible();
  await expect(page.locator('.errbox')).toHaveCount(0);

  // Every range loads.
  for (const r of ['Day', 'Week', 'YTD', 'Year']) {
    await page.getByRole('button', { name: r, exact: true }).click();
    await expect(page.getByText('Total sales')).toBeVisible();
    await expect(page.locator('.errbox')).toHaveCount(0);
  }

  // Day view: date picker + step to a previous day.
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(page.locator('.datepick')).toBeVisible();
  await page.getByRole('button', { name: 'Previous period' }).click();
  await expect(page.getByText('Total sales')).toBeVisible();

  // Switch to Menu via the section tab bar → categories + food/drink render.
  await page.getByRole('tab', { name: 'Menu' }).click();
  await expect(page.getByText('Food vs drink')).toBeVisible();
  await expect(page.getByText('By category', { exact: true })).toBeVisible();
  await expect(page.locator('.errbox')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/waj-sales-overview.png', fullPage: true });
});

test('manager API returns What a Jerk-scoped data', async ({ page }) => {
  await login(page, MANAGER);
  const res = await page.request.get('/api/sales?range=week');
  expect(res.status()).toBe(200);
  const j = await res.json();
  expect(j.success).toBeTruthy();
  expect(String(j.data.meta.company)).toMatch(/jerk/i);
  expect(j.data.meta.companyId).toBeGreaterThan(0);
});

test('staff is blocked from the sales dashboard (redirect + 403)', async ({ page }) => {
  await login(page, STAFF);
  await page.goto('/sales');
  await expect(page).not.toHaveURL(/\/sales$/);
  const res = await page.request.get('/api/sales?range=week');
  expect(res.status()).toBe(403);
});
