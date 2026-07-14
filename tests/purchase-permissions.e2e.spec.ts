import { test, expect, Page } from '@playwright/test';

/**
 * Real-browser verification of the per-action Permission system for the Purchase module.
 * Runs against staging via the `modules` project: `npm run test:inventory -- tests/purchase-permissions.e2e.spec.ts`
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

async function purchaseCaps(page: Page): Promise<string[]> {
  const r = await page.request.get('/api/auth/me');
  const caps: string[] = (await r.json()).user?.capabilities ?? [];
  return caps.filter((c) => c.startsWith('purchase.')).sort();
}

test('staff has only the all-role Purchase capabilities by default', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  const caps = await purchaseCaps(page);
  expect(caps).toContain('purchase.order.send'); // placing an order = all roles today
  expect(caps).not.toContain('purchase.supplier.manage');
  expect(caps).not.toContain('purchase.guide.manage');
  expect(caps).not.toContain('purchase.receive.confirm');
  expect(caps).not.toContain('purchase.suppliers.seed');
});

test('server refuses staff manager-only Purchase actions (403)', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  // View spend insights — manager-gated read.
  const insights = await page.request.get('/api/purchase/analytics', { failOnStatusCode: false });
  expect(insights.status()).toBe(403);
  // Create a supplier — manager-gated write; roleCan runs before any Odoo call.
  const supplier = await page.request.post('/api/purchase/suppliers', { data: {}, failOnStatusCode: false });
  expect(supplier.status()).toBe(403);
});

test('admin sees the Purchase section on the Permissions screen', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/permissions', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Permissions' })).toBeVisible();
  await expect(page.getByText('Place / send an order to a supplier')).toBeVisible();
  await expect(page.getByText('Add / edit / remove suppliers')).toBeVisible();
});

test('toggling a Purchase capability changes what the role can do (grant, verify, reset)', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  try {
    const grant = await admin.request.post('/api/admin/permissions', {
      data: { action_key: 'purchase.supplier.manage', allowed_roles: ['staff', 'manager', 'admin'] },
      failOnStatusCode: false,
    });
    expect(grant.status()).toBe(200);

    const staffCtx = await browser.newContext();
    const staff = await staffCtx.newPage();
    await login(staff, STAFF.email, STAFF.password);
    expect(await purchaseCaps(staff)).toContain('purchase.supplier.manage');
    await staffCtx.close();
  } finally {
    await admin.request.post('/api/admin/permissions', {
      data: { reset: 'module', module: 'purchase' }, failOnStatusCode: false,
    });
    await adminCtx.close();
  }
});
