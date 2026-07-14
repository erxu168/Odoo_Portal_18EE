import { test, expect, Page } from '@playwright/test';

/**
 * Real-browser verification of the per-action Permission system (Manufacturing module).
 * Runs against staging via the `modules` project: `npm run test:inventory -- tests/permissions.e2e.spec.ts`
 * Credentials come from env with staging test-account fallbacks.
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

async function mfgCaps(page: Page): Promise<string[]> {
  const r = await page.request.get('/api/auth/me');
  const caps: string[] = (await r.json()).user?.capabilities ?? [];
  return caps.filter((c) => c.startsWith('manufacturing.')).sort();
}

test('staff has only the all-role Manufacturing capabilities by default', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  const caps = await mfgCaps(page);
  // all-role defaults present
  expect(caps).toContain('manufacturing.mo.components');
  expect(caps).toContain('manufacturing.mo.saveversion');
  expect(caps).toContain('manufacturing.bom.setcurrent');
  // manager-only capabilities absent
  expect(caps).not.toContain('manufacturing.mo.create');
  expect(caps).not.toContain('manufacturing.bom.edit');
  expect(caps).not.toContain('manufacturing.shelflife.edit');
});

test('server refuses a staff create-manufacturing-order (403)', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  const res = await page.request.post('/api/manufacturing-orders', { data: {}, failOnStatusCode: false });
  expect(res.status()).toBe(403); // requireCapability runs before any Odoo call
});

test('staff is denied the admin Permissions screen (API + UI)', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  const api = await page.request.get('/api/admin/permissions', { failOnStatusCode: false });
  expect(api.status()).toBe(403);
  await page.goto('/admin/permissions', { waitUntil: 'networkidle' });
  await expect(page.getByText(/admin access/i)).toBeVisible();
  await expect(page.getByText('Create a manufacturing order')).toHaveCount(0);
});

test('admin sees the Manufacturing section on the Permissions screen', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/permissions', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Permissions' })).toBeVisible();
  await expect(page.getByText('Create a manufacturing order')).toBeVisible();
  await expect(page.getByText('Edit shelf life')).toBeVisible();
});

test('toggling a capability changes what the role can do (grant, verify, reset)', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  try {
    // Grant staff the manager-only create capability.
    const grant = await admin.request.post('/api/admin/permissions', {
      data: { action_key: 'manufacturing.mo.create', allowed_roles: ['staff', 'manager', 'admin'] },
      failOnStatusCode: false,
    });
    expect(grant.status()).toBe(200);

    // A fresh staff session now sees the capability.
    const staffCtx = await browser.newContext();
    const staff = await staffCtx.newPage();
    await login(staff, STAFF.email, STAFF.password);
    expect(await mfgCaps(staff)).toContain('manufacturing.mo.create');
    await staffCtx.close();
  } finally {
    // Always restore defaults so staging is left clean.
    await admin.request.post('/api/admin/permissions', {
      data: { reset: 'module', module: 'manufacturing' }, failOnStatusCode: false,
    });
    await adminCtx.close();
  }
});
