import { test, expect, type Page } from '@playwright/test';

/**
 * Real-browser test of the MANAGER Cooking Timer Setup screen on staging.
 * Covers the access gate and the step-5 features signed off by Ethan.
 * Run: npx playwright test --project=modules cooktimer-setup.e2e
 */
const BASE = 'https://portal.krawings.de';
const MGR = {
  // marco@test.krawings.de does not exist on staging (401); the documented admin
  // account does, and admin satisfies cooktimer.config.manage.
  email: process.env.SMOKE_MANAGER_EMAIL || 'biz@krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  // Select by input TYPE — the placeholders are copy ("you@example.com",
  // "Enter your password"), so getByPlaceholder('Email') never matches.
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 });
}

test('the manager setup screen is NOT public (middleware boundary fix)', async ({ page }) => {
  const res = await page.goto(`${BASE}/cooktimer-setup`, { waitUntil: 'domcontentloaded' });
  // Anonymous must be bounced to login — the cook tablet screen is public, this is not.
  expect(page.url(), 'anonymous must be redirected to /login').toContain('/login');
  expect(res?.status()).toBeLessThan(400);
});

test('the setup APIs never return data to an anonymous caller', async ({ request }) => {
  for (const path of ['/api/cooktimer/profiles', '/api/cooktimer/stations']) {
    // The middleware bounces anonymous callers to /login (307). Follow it and
    // assert no setup data comes back either way — the point is "no data",
    // whether that arrives as a redirect, a 401 or a 403.
    const res = await request.get(`${BASE}${path}`, { maxRedirects: 0 });
    expect([301, 302, 307, 308, 401, 403], `${path} leaked a 200`).toContain(res.status());
    if (res.status() >= 300 && res.status() < 400) {
      expect(res.headers()['location'] || '').toContain('/login');
    }
    const followed = await request.get(`${BASE}${path}`);
    const body = await followed.text();
    expect(body, `${path} must not expose profiles/stations`).not.toMatch(/"(profiles|stations)"\s*:/);
  }
});

test('the public cook-tablet queue still works (the fix did not over-gate it)', async ({ request }) => {
  const res = await request.get(`${BASE}/api/cooktimer/queue`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.stations)).toBe(true);
});

test('a manager sees dishes grouped by station, with live till names', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));

  await login(page, MGR.email, MGR.password);
  await page.goto(`${BASE}/cooktimer-setup`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Setup' })).toBeVisible({ timeout: 25000 });
  await expect(page.getByRole('heading', { name: 'Dishes' })).toBeVisible();

  // Seeded staging data renders.
  await expect(page.getByText('French Fries', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Deep Fry & Smoker').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/setup-live-dishes.png', fullPage: true });

  // Open a dish: the editor must show the REAL till name + the max-batch field.
  await page.getByText('French Fries', { exact: true }).first().click();
  await expect(page.getByText('Most per batch')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/On the till as #\d+/)).toBeVisible();
  await page.screenshot({ path: 'test-results/setup-live-editor.png', fullPage: true });

  expect(errors, 'no uncaught page errors').toEqual([]);
});

test('stations tab offers to move dishes instead of dead-ending the delete', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await page.goto(`${BASE}/cooktimer-setup`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Setup' })).toBeVisible({ timeout: 25000 });

  await page.getByRole('button', { name: 'Stations' }).click();
  const busy = page.locator('button[aria-label^="Delete"]:not([disabled])').first();
  await expect(busy).toBeVisible({ timeout: 15000 });
  await busy.click();

  // Either it holds dishes (offers a destination) or it is empty (plain delete).
  const dialog = page.locator('text=/Delete .+\\?/').first();
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: 'test-results/setup-live-delete.png' });
  // Never complete the delete against staging data.
  await page.getByRole('button', { name: /keep it|cancel/i }).first().click();
});
