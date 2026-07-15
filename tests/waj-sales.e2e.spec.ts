import { test, expect, type Page } from '@playwright/test';

// Test accounts are the ones documented in CLAUDE.md (staging only).
const MANAGER = { email: process.env.WAJ_MANAGER_EMAIL || 'marco@test.krawings.de', password: process.env.WAJ_MANAGER_PW || 'test1234' };
const STAFF = { email: process.env.WAJ_STAFF_EMAIL || 'hana@test.krawings.de', password: process.env.WAJ_STAFF_PW || 'test1234' };

async function login(page: Page, u: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(u.email);
  await page.getByPlaceholder('Enter your password').fill(u.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

test('manager can open the What a Jerk sales dashboard and use every tab/range', async ({ page }) => {
  await login(page, MANAGER);
  await page.goto('/sales');
  await expect(page).toHaveURL(/\/sales/);

  await expect(page.getByText('Total sales')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.errbox')).toHaveCount(0);

  for (const t of ['Menu', 'Busy times', 'Orders', 'Team', 'Kitchen', 'Overview']) {
    await page.getByRole('tab', { name: t }).click();
    await expect(page.locator('.errbox')).toHaveCount(0);
  }

  for (const r of ['Day', 'Week', 'Month', 'YTD', 'Year']) {
    await page.getByRole('button', { name: r, exact: true }).click();
    await expect(page.getByText('Total sales')).toBeVisible();
    await expect(page.locator('.errbox')).toHaveCount(0);
  }

  // Day view: date picker present + stepper navigates to a previous day.
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(page.locator('.datepick')).toBeVisible();
  await page.getByRole('button', { name: 'Previous period' }).click();
  await expect(page.getByText('Total sales')).toBeVisible();
  await expect(page.locator('.errbox')).toHaveCount(0);

  // Year picker: pick the previous year and confirm the fetch for that year loads.
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  const yearSel = page.locator('.yearsel select');
  const prevYear = String(new Date().getFullYear() - 1);
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/sales') && r.url().includes(`anchor=${prevYear}-`)),
    yearSel.selectOption(prevYear),
  ]);
  await expect(page.getByText('Total sales')).toBeVisible();
  await expect(page.locator('.errbox')).toHaveCount(0);

  // Back to the current year, Menu tab: categories + food-vs-drink render.
  await yearSel.selectOption(String(new Date().getFullYear()));
  await page.getByRole('tab', { name: 'Menu' }).click();
  await expect(page.getByText('Food vs drink')).toBeVisible();
  await expect(page.getByText('By category', { exact: true })).toBeVisible();
  await expect(page.locator('.errbox')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/waj-sales-menu.png', fullPage: true });
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
