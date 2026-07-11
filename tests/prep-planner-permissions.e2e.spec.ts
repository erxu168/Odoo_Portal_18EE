import { test, expect, Page } from '@playwright/test';

/**
 * Real-browser verification of the per-action Permission system for the Prep Planner module.
 * Also confirms the previously-unauthenticated item/forecast routes are now gated.
 * Runs against staging via the `modules` project.
 */
const ADMIN = {
  email: process.env.SMOKE_ADMIN_EMAIL || 'biz@krawings.de',
  password: process.env.SMOKE_ADMIN_PASSWORD || 'test1234',
};
const STAFF = {
  email: process.env.SMOKE_STAFF_EMAIL || 'hana@test.krawings.de',
  password: process.env.SMOKE_STAFF_PASSWORD || 'test1234',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  const btn = page.getByRole('button', { name: /sign in|log in|anmelden/i });
  if (await btn.count()) await btn.first().click(); else await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
}

async function prepCaps(page: Page): Promise<string[]> {
  const r = await page.request.get('/api/auth/me');
  const caps: string[] = (await r.json()).user?.capabilities ?? [];
  return caps.filter((c) => c.startsWith('prep-planner.')).sort();
}

test('staff has no Prep Planner capabilities by default (all manager+admin)', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  expect(await prepCaps(page)).toEqual([]);
});

test('server refuses staff Prep Planner actions incl. the formerly-open routes (403)', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  for (const url of ['/api/prep-planner/items', '/api/prep-planner/forecasts', '/api/prep-planner/variance']) {
    const res = await page.request.get(url, { failOnStatusCode: false });
    expect(res.status(), url).toBe(403);
  }
  const run = await page.request.post('/api/prep-planner/run', { data: {}, failOnStatusCode: false });
  expect(run.status()).toBe(403);
});

test('admin sees the Prep Planner section on the Permissions screen', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/permissions', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Permissions' })).toBeVisible();
  await expect(page.getByText('Run the prep forecast')).toBeVisible();
  await expect(page.getByText('Create & edit prep items')).toBeVisible();
});

test('toggling a Prep Planner capability flips server enforcement (grant, verify, reset)', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  try {
    const grant = await admin.request.post('/api/admin/permissions', {
      data: { action_key: 'prep-planner.forecast.view', allowed_roles: ['staff', 'manager', 'admin'] },
      failOnStatusCode: false,
    });
    expect(grant.status()).toBe(200);

    const staffCtx = await browser.newContext();
    const staff = await staffCtx.newPage();
    await login(staff, STAFF.email, STAFF.password);
    expect(await prepCaps(staff)).toContain('prep-planner.forecast.view');
    // the guard now passes for staff (no longer 403 — falls through to the missing-param 400)
    const res = await staff.request.get('/api/prep-planner/items', { failOnStatusCode: false });
    expect(res.status()).not.toBe(403);
    await staffCtx.close();
  } finally {
    await admin.request.post('/api/admin/permissions', {
      data: { reset: 'module', module: 'prep-planner' }, failOnStatusCode: false,
    });
    await adminCtx.close();
  }
});
