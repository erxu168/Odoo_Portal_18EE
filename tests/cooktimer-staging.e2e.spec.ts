import { test, expect } from '@playwright/test';

/**
 * Real-browser smoke test of the Cooking Timer station screen on STAGING.
 * No login: /cooktimer is a public kitchen-tablet screen (like /kds).
 * Run: SMOKE_ENV=staging npx playwright test --project=modules cooktimer-staging
 */
const URL = 'https://portal.krawings.de/cooktimer';

test('cooking timer station screen loads and renders its shell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));

  const res = await page.goto(URL, { waitUntil: 'domcontentloaded' });
  expect(res?.status(), 'should load without a login redirect').toBe(200);
  expect(page.url(), 'must NOT bounce to /login').toContain('/cooktimer');

  // Brand + the two panes from the approved mock (class selectors: several
  // elements share this copy, so getByText would be ambiguous in strict mode).
  await expect(page.locator('.ct-logo')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.ct-queue-h')).toHaveText('TO COOK');
  await expect(page.locator('.ct-dlabel')).toBeVisible();

  // Either a queue card or the empty-state must render (never a blank rail).
  const queueEmpty = page.locator('.ct-queue-empty');
  const queueCards = page.locator('.ct-qcard');
  await expect
    .poll(async () => (await queueCards.count()) + (await queueEmpty.count()), { timeout: 20000 })
    .toBeGreaterThan(0);

  // Board shows either running timers or its empty state.
  const boardEmpty = page.locator('.ct-board-empty');
  const timerCards = page.locator('.ct-tcard');
  expect((await boardEmpty.count()) + (await timerCards.count())).toBeGreaterThan(0);

  expect(errors, 'no uncaught page errors').toEqual([]);
  await page.screenshot({ path: 'test-results/cooktimer-staging.png', fullPage: true });
});

test('settings overlay opens with stations and sound toggles', async ({ page }) => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.ct-queue-h')).toBeVisible({ timeout: 20000 });

  await page.locator('.ct-gear').click();
  await expect(page.getByText('Tablet settings')).toBeVisible();
  await expect(page.getByText('Sound', { exact: true })).toBeVisible();
  // Seeded stations must be listed so a tablet can pick which it shows.
  await expect(page.locator('.ct-srow')).not.toHaveCount(0);
  await page.screenshot({ path: 'test-results/cooktimer-settings.png' });

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Tablet settings')).toBeHidden();
});

test('the live queue API responds for the tablet', async ({ request }) => {
  const res = await request.get('https://portal.krawings.de/api/cooktimer/queue');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('queue');
  expect(Array.isArray(body.queue)).toBe(true);
  expect(Array.isArray(body.stations)).toBe(true);
  // Stations are seeded on staging, so the tablet has something to filter by.
  expect(body.stations.length).toBeGreaterThan(0);
});
