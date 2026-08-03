/**
 * E2E: photo review + end-of-day summary (Task Manager) — real-browser, staging.
 *
 * Verifies the deployed HTTP surface: the manager review feed, the summary
 * settings round-trip (enable → verify → restore), and that both new screens
 * render. The flag INVARIANT (flagging never changes completion) is proven
 * separately against deployed Odoo with a controlled temp record.
 *
 * Admin biz@krawings.de has companies [1,2,3,6]. Env: SMOKE_ADMIN_*.
 */
import { test, expect, Page } from '@playwright/test';

const ADMIN = {
  email: process.env.SMOKE_ADMIN_EMAIL || 'biz@krawings.de',
  password: process.env.SMOKE_ADMIN_PASSWORD || 'test1234',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  const btn = page.getByRole('button', { name: /sign in|log in|anmelden/i });
  if (await btn.count()) await btn.first().click(); else await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('unauthenticated review API is not readable', async ({ request }) => {
  const r = await request.get('/api/tasks/review', { failOnStatusCode: false, maxRedirects: 0 });
  expect(r.status()).not.toBe(200);
});

test('review feed + summary settings round-trip + pages render', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  // 1) The review feed loads with the right shape (may legitimately be empty).
  const feed = await page.request.get('/api/tasks/review');
  expect(feed.ok()).toBeTruthy();
  const feedBody = await feed.json();
  expect(feedBody.stats).toBeTruthy();
  expect(typeof feedBody.stats.submitted).toBe('number');
  expect(Array.isArray(feedBody.items)).toBeTruthy();

  // 2) Summary settings round-trip: read → enable a company → verify → restore.
  const get1 = await page.request.get('/api/tasks/admin/summary-settings');
  expect(get1.ok()).toBeTruthy();
  const companies = (await get1.json()).companies as { id: number; name: string; enabled: boolean; hour: number }[];
  expect(Array.isArray(companies)).toBeTruthy();
  expect(companies.length).toBeGreaterThan(0);
  const target = companies[0];

  const put = await page.request.put('/api/tasks/admin/summary-settings', {
    data: { companies: [{ id: target.id, enabled: true, hour: 22.5 }] },
  });
  expect(put.ok()).toBeTruthy();

  const get2 = await page.request.get('/api/tasks/admin/summary-settings');
  const after = (await get2.json()).companies.find((c: { id: number }) => c.id === target.id);
  expect(after.enabled).toBe(true);
  expect(after.hour).toBe(22.5);

  // Restore to whatever it was (so we don't leave the summary on).
  const restore = await page.request.put('/api/tasks/admin/summary-settings', {
    data: { companies: [{ id: target.id, enabled: target.enabled, hour: target.hour }] },
  });
  expect(restore.ok()).toBeTruthy();

  // A bad hour is rejected (server allowlist).
  const bad = await page.request.put('/api/tasks/admin/summary-settings', {
    data: { companies: [{ id: target.id, enabled: true, hour: 3 }] },
    failOnStatusCode: false,
  });
  expect(bad.status()).toBe(400);

  // 3) Both screens render.
  await page.goto('/tasks/manager/review', { waitUntil: 'networkidle' });
  await expect(page.getByText('Photo review').first()).toBeVisible({ timeout: 20_000 });
  await page.goto('/tasks/admin', { waitUntil: 'networkidle' });
  await expect(page.getByText('End-of-day summary').first()).toBeVisible({ timeout: 20_000 });
});
