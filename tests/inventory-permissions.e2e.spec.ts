import { test, expect, Page } from '@playwright/test';

/**
 * Real-browser verification of the per-action Permission system for the Inventory module.
 * Runs against staging via the `modules` project: `npm run test:inventory -- tests/inventory-permissions.e2e.spec.ts`
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

async function invCaps(page: Page): Promise<string[]> {
  const r = await page.request.get('/api/auth/me');
  const caps: string[] = (await r.json()).user?.capabilities ?? [];
  return caps.filter((c) => c.startsWith('inventory.')).sort();
}

test('staff has only the all-role Inventory capabilities by default', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  const caps = await invCaps(page);
  expect(caps).toContain('inventory.product.create'); // scan-create = all roles today
  expect(caps).not.toContain('inventory.review.approve');
  expect(caps).not.toContain('inventory.draft.review');
  expect(caps).not.toContain('inventory.template.manage');
  expect(caps).not.toContain('inventory.consumption.view');
  expect(caps).not.toContain('inventory.productsettings.manage');
});

test('server refuses staff manager-only Inventory actions (403)', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  // Consumption report — manager-gated read.
  const consumption = await page.request.get('/api/inventory/consumption', { failOnStatusCode: false });
  expect(consumption.status()).toBe(403);
  // Approve counts into stock — manager-gated write; roleCan runs before any Odoo call.
  const approve = await page.request.post('/api/inventory/approve', { data: {}, failOnStatusCode: false });
  expect(approve.status()).toBe(403);
});

test('admin sees the Inventory section on the Permissions screen', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/permissions', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Permissions' })).toBeVisible();
  await expect(page.getByText('Approve / reject / reopen counts (into stock)')).toBeVisible();
  await expect(page.getByText('View consumption report')).toBeVisible();
});

test('toggling an Inventory capability changes what the role can do (grant, verify, reset)', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  try {
    const grant = await admin.request.post('/api/admin/permissions', {
      data: { action_key: 'inventory.consumption.view', allowed_roles: ['staff', 'manager', 'admin'] },
      failOnStatusCode: false,
    });
    expect(grant.status()).toBe(200);

    const staffCtx = await browser.newContext();
    const staff = await staffCtx.newPage();
    await login(staff, STAFF.email, STAFF.password);
    expect(await invCaps(staff)).toContain('inventory.consumption.view');
    // and the server now allows the staff member to load the consumption report
    const consumption = await staff.request.get('/api/inventory/consumption', { failOnStatusCode: false });
    expect(consumption.status()).not.toBe(403);
    await staffCtx.close();
  } finally {
    await admin.request.post('/api/admin/permissions', {
      data: { reset: 'module', module: 'inventory' }, failOnStatusCode: false,
    });
    await adminCtx.close();
  }
});
