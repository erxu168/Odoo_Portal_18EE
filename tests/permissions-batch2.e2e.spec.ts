import { test, expect, Page } from '@playwright/test';

/**
 * Real-browser verification of the per-action Permission system for the second batch of modules:
 * Chef Guide (recipes), Supplier Logins (credentials), My Tasks (tasks). Runs against staging.
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

test('staff is blocked from manager actions across recipes / credentials / tasks (403)', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  // Chef Guide — approve a recipe (manager)
  const approve = await page.request.post('/api/recipes/approve', { data: {}, failOnStatusCode: false });
  expect(approve.status(), 'recipes/approve').toBe(403);
  // Supplier Logins — view (manager). This route returns 401 (not 403) for authed-but-forbidden
  // via its pre-existing combined `!user || !roleCan` guard; either way staff is denied.
  const creds = await page.request.get('/api/admin/credentials', { failOnStatusCode: false });
  expect([401, 403], 'admin/credentials').toContain(creds.status());
  // My Tasks — manager dashboard (manager)
  const dash = await page.request.get('/api/tasks/manager/dashboard', { failOnStatusCode: false });
  expect(dash.status(), 'tasks/manager/dashboard').toBe(403);
});

test('admin sees the new module sections on the Permissions screen', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/permissions', { waitUntil: 'networkidle' });
  await expect(page.getByText('Approve a recipe')).toBeVisible();
  await expect(page.getByText('View supplier logins')).toBeVisible();
  await expect(page.getByText('Manage checklists & templates')).toBeVisible();
});

test('toggling tasks.manager.view flips server enforcement (grant, verify, reset)', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN.email, ADMIN.password);
  try {
    const grant = await admin.request.post('/api/admin/permissions', {
      data: { action_key: 'tasks.manager.view', allowed_roles: ['staff', 'manager', 'admin'] },
      failOnStatusCode: false,
    });
    expect(grant.status()).toBe(200);

    const staffCtx = await browser.newContext();
    const staff = await staffCtx.newPage();
    await login(staff, STAFF.email, STAFF.password);
    const caps: string[] = (await (await staff.request.get('/api/auth/me')).json()).user?.capabilities ?? [];
    expect(caps).toContain('tasks.manager.view');
    const dash = await staff.request.get('/api/tasks/manager/dashboard', { failOnStatusCode: false });
    expect(dash.status()).not.toBe(403);
    await staffCtx.close();
  } finally {
    await admin.request.post('/api/admin/permissions', {
      data: { reset: 'module', module: 'tasks' }, failOnStatusCode: false,
    });
    await adminCtx.close();
  }
});
