import { test, expect, Page } from '@playwright/test';

/**
 * Floorplan module on staging via the `modules` project:
 *   npm run test:inventory -- tests/floorplan.e2e.spec.ts
 *
 * Data-independent by design: WAJ (the test users' company) may or may not
 * have a plan uploaded, so the assertions cover role gating, route health and
 * the correct EMPTY state — the data-full path is covered by local
 * browser-driven verification against the real SSK96 plan.
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

test('staff can open the floorplan (map or clean empty state, never an error)', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  await page.goto('/inventory/floorplan', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Floorplan').first()).toBeVisible({ timeout: 20_000 });
  // either a live map or the no-plan empty state — never the failure screen
  await expect
    .poll(async () => {
      const hasMap = await page.locator('.leaflet-image-layer').count();
      const hasEmpty = await page.getByText('No floor plan here yet').count();
      return hasMap + hasEmpty;
    }, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(page.getByText('could not be loaded')).toHaveCount(0);
});

test('staff get the view capability but not manage; server enforces it', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  const me = await page.request.get('/api/auth/me');
  const caps: string[] = (await me.json()).user?.capabilities ?? [];
  expect(caps).toContain('inventory.floorplan.view');
  expect(caps).not.toContain('inventory.location.manage');

  const create = await page.request.post('/api/inventory/floorplans', {
    data: { name: 'Nope' }, failOnStatusCode: false,
  });
  expect(create.status()).toBe(403);
  const publish = await page.request.post('/api/inventory/floorplan-revisions/1/publish', {
    data: { version: 1 }, failOnStatusCode: false,
  });
  expect(publish.status()).toBe(403);
});

test('manage screen shows the managers-only gate to staff', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  await page.goto('/inventory/floorplan/manage', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Managers only')).toBeVisible({ timeout: 20_000 });
});

test('admin can list floors and read the manifest; deep link rejects garbage', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const floors = await page.request.get('/api/inventory/floorplans', { failOnStatusCode: false });
  expect(floors.status()).toBe(200);
  const manifest = await page.request.get('/api/inventory/floorplan', { failOnStatusCode: false });
  expect(manifest.status()).toBe(200);
  const bad = await page.request.get('/api/inventory/floorplan?spot=abc', { failOnStatusCode: false });
  expect(bad.status()).toBe(400);
  const missing = await page.request.get('/api/inventory/floorplan?spot=99999999', { failOnStatusCode: false });
  expect(missing.status()).toBe(404);
});

test('the floorplan tile appears on the Inventory dashboard', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Floorplan', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});
