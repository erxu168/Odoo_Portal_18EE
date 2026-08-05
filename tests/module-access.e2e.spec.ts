import { test, expect, Page } from '@playwright/test';

/**
 * REAL-BROWSER proof that a module which is switched off is actually gone.
 *
 * Why this file exists: the unit tests prove the RULE, but they cannot prove the
 * screens obey it. Worse, this repo's 14 browser tests have been auto-skipping on
 * every CI run because SMOKE_EMAIL / SMOKE_PASSWORD were never configured — a
 * green "Portal Smoke Test" that ran no browser at all. This suite needs no
 * shared secret: it drives its own throwaway accounts.
 *
 * Accounts (seeded into the run's own SQLite, never staging):
 *   zz-e2e-mod-staff@test.krawings.de  — staff, no custom module list
 *   zz-e2e-mod-admin@test.krawings.de  — admin
 * Both with E2E_PASSWORD (default 'e2e-test-1234').
 *
 * RUNBOOK — takes about a minute, and never touches staging:
 *
 *   1. Work in a throwaway clone, because it seeds users and toggles the role
 *      grid, and because this repo allows only one dev server per checkout:
 *        git clone /Users/ethan/Odoo_Portal_18EE ~/portal-e2e && cd ~/portal-e2e
 *        ln -s /Users/ethan/Odoo_Portal_18EE/node_modules node_modules
 *        cp /Users/ethan/Odoo_Portal_18EE/.env.local .
 *        mkdir -p data && cp /Users/ethan/Odoo_Portal_18EE/data/portal.db data/
 *   2. PORTAL_DB_PATH=./data/portal.db node scripts/seed-e2e-module-users.mjs
 *   3. npx next dev -p 3100
 *   4. npm run test:module-access
 *
 * Point E2E_BASE_URL somewhere else to run it against another instance.
 */
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3100';
const PASSWORD = process.env.E2E_PASSWORD || 'e2e-test-1234';
const STAFF = 'zz-e2e-mod-staff@test.krawings.de';
const ADMIN = 'zz-e2e-mod-admin@test.krawings.de';

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

test.describe.configure({ mode: 'serial' });

test('staff do NOT see Manufacturing anywhere on the home screen', async ({ page }) => {
  await login(page, STAFF);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

  // The tile grid has to have rendered before "not visible" means anything.
  await expect(page.getByText('Inventory').first()).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText('Manufacturing')).toHaveCount(0);
  // ...and the bottom tab bar's "Prep" tab, which used to show for everyone.
  await expect(page.getByRole('button', { name: 'Prep' })).toHaveCount(0);
});

test('typing the URL gets staff the no-access screen, not the module', async ({ page }) => {
  await login(page, STAFF);

  for (const path of ['/manufacturing', '/rentals', '/termination']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByText(/You don.t have access to this/i),
      `${path} should be blocked for staff`,
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: /back to home/i })).toBeVisible();
  }
});

test('the modules staff DO have still work', async ({ page }) => {
  await login(page, STAFF);
  for (const path of ['/inventory', '/recipes', '/labels']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByText(/You don.t have access to this/i),
      `${path} must NOT be blocked — staff have it`,
    ).toHaveCount(0);
  }
});

test('the API refuses a module the user does not have', async ({ page }) => {
  await login(page, STAFF);
  // Session cookie rides along, so this is an authenticated staff request.
  const blocked = await page.request.get(`${BASE}/api/rentals/properties`);
  expect(blocked.status(), 'staff must be refused Rentals data').toBe(403);

  const allowed = await page.request.get(`${BASE}/api/auth/modules`);
  expect(allowed.ok()).toBe(true);
  const body = await allowed.json();
  expect(body.modules).not.toContain('production');
  expect(body.modules).toContain('inventory');
});

test('the admin role grid renders with Admin locked on', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto(`${BASE}/admin/permissions`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Which apps each role gets')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('What they can do inside')).toBeVisible();

  // Every Admin cell is disabled — admins always keep access.
  const adminCells = page.getByRole('button', { name: /— Admin (on|off)$/ });
  const n = await adminCells.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await expect(adminCells.nth(i)).toBeDisabled();
    await expect(adminCells.nth(i)).toHaveAccessibleName(/— Admin on$/);
  }
});

test('unticking a module in the grid takes it away from staff for real', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const staffCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const staff = await staffCtx.newPage();
  try {
    // Waste Tracker is a harmless staff module — before: staff can open it.
    await login(staff, STAFF);
    let res = await staff.request.get(`${BASE}/api/auth/modules`);
    expect((await res.json()).modules).toContain('waste');

    // Admin unticks Staff for Waste Tracker in the grid.
    await login(admin, ADMIN);
    await admin.goto(`${BASE}/admin/permissions`, { waitUntil: 'domcontentloaded' });
    const cell = admin.getByRole('button', { name: 'Waste Tracker — Staff on' });
    await expect(cell).toBeVisible({ timeout: 30_000 });
    await cell.click();
    await expect(
      admin.getByRole('button', { name: 'Waste Tracker — Staff off' }),
    ).toBeVisible({ timeout: 15_000 });

    // The SAME staff session is now refused — no re-login, no cache excuse.
    res = await staff.request.get(`${BASE}/api/auth/modules`);
    expect((await res.json()).modules, 'staff should have lost Waste').not.toContain('waste');
    await staff.goto(`${BASE}/waste`, { waitUntil: 'domcontentloaded' });
    await expect(staff.getByText(/You don.t have access to this/i)).toBeVisible({ timeout: 30_000 });

    // Reset puts it back — the grid is not a one-way door.
    await admin.getByRole('button', { name: 'Waste Tracker — Staff off' }).click();
    await expect(
      admin.getByRole('button', { name: 'Waste Tracker — Staff on' }),
    ).toBeVisible({ timeout: 15_000 });
    res = await staff.request.get(`${BASE}/api/auth/modules`);
    expect((await res.json()).modules, 'staff should have Waste back').toContain('waste');
  } finally {
    await adminCtx.close();
    await staffCtx.close();
  }
});
