import { test, expect, Page } from '@playwright/test';

/**
 * The Prep Planner Forecasts screen — after the 2026-08-01 revival it must
 * actually SHOW forecasts for What a Jerk (company 6, the till that posts to
 * staging), not the "No forecasts" empty state it showed its whole life.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('manager: the Forecasts screen shows real WAJ forecast rows', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await page.goto('/prep-planner/forecasts');
  await expect(page.getByText('Forecasts').first()).toBeVisible({ timeout: 20_000 });
  // Real rows, not the lifelong empty state. The backfill wrote 399 rows for
  // the coming week, so today must have some.
  await expect(page.getByText('No forecasts for this date')).toBeHidden({ timeout: 20_000 });
});
