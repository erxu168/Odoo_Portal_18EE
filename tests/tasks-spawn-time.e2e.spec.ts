/**
 * E2E: per-restaurant daily-checklist spawn time (/tasks/admin).
 *
 * Verifies the admin settings card loads real per-company hours from Odoo
 * (res.company.kw_task_spawn_hour via /api/tasks/admin/spawn-time), that a
 * change round-trips through Save + reload, and that the endpoint is not
 * reachable without a session. The original value is captured via the API
 * before any mutation and restored in a finally block, so an assertion
 * failure mid-test cannot leave the live setting changed.
 *
 * Env (defaults target staging):
 *   SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD
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
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
}

test('spawn-time API is not reachable without a session', async ({ request }) => {
  const res = await request.get('/api/tasks/admin/spawn-time', {
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  expect(res.status()).not.toBe(200);
});

test('admin can see and round-trip a spawn-time change', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  // Capture the current state via the API before touching anything.
  const before = await page.request.get('/api/tasks/admin/spawn-time');
  expect(before.ok()).toBeTruthy();
  const { companies } = await before.json();
  expect(companies.length).toBeGreaterThan(0);
  const target = companies[0] as { id: number; name: string; spawn_hour: number };
  const changedHour = (target.spawn_hour + 1) % 24;

  try {
    await page.goto('/tasks/admin', { waitUntil: 'networkidle' });
    await expect(page.getByText('Checklist creation time', { exact: true })).toBeVisible();

    const select = page.locator(`select[aria-label="Checklist creation time for ${target.name}"]`);
    await expect(select).toBeVisible({ timeout: 20_000 });
    expect(await select.inputValue()).toBe(String(target.spawn_hour));

    // Change → save → persisted across reload.
    await select.selectOption(String(changedHour));
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText('Saved ✓')).toBeVisible({ timeout: 15_000 });

    await page.reload({ waitUntil: 'networkidle' });
    await expect(select).toBeVisible({ timeout: 20_000 });
    expect(await select.inputValue()).toBe(String(changedHour));
  } finally {
    // Always restore the original value, even if an assertion failed above.
    const restore = await page.request.put('/api/tasks/admin/spawn-time', {
      data: { companies: [{ id: target.id, spawn_hour: target.spawn_hour }] },
    });
    expect(restore.ok()).toBeTruthy();
  }
});
