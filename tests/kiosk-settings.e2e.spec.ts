import { test, expect, Page } from '@playwright/test';

/**
 * Kiosk settings e2e — drives the real /kiosk screen on staging in a browser.
 * Verifies the manager-gated on-tablet settings:
 *   - a fresh tablet offers a setup path (not a dead end),
 *   - a staff-level account is refused,
 *   - a manager can set the restaurant and the choice persists across reloads.
 * Creds fall back to the staging test accounts so it runs out of the box.
 *   SMOKE_MANAGER_EMAIL / SMOKE_MANAGER_PASSWORD  (a manager or admin)
 *   SMOKE_TABLET_EMAIL  / SMOKE_TABLET_PASSWORD    (shared tablet — staff role)
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const STAFF = {
  email: process.env.SMOKE_TABLET_EMAIL || 'waj-kitchen@krawings.de',
  password: process.env.SMOKE_TABLET_PASSWORD || 'WajKitchen#2026',
};

async function openLoginGate(page: Page) {
  await page.goto('/kiosk');
  await page.getByRole('button', { name: 'Kiosk settings' }).click();
  await expect(page.getByText(/Manager sign-in/i)).toBeVisible();
}

test('fresh kiosk shows a setup path, not a dead end', async ({ page }) => {
  await page.goto('/kiosk');
  await expect(page.getByText('This tablet is not set up yet')).toBeVisible();
  await expect(page.getByRole('button', { name: /Set up this tablet/i })).toBeVisible();
});

test('a staff-level account is refused from settings', async ({ page }) => {
  await openLoginGate(page);
  await page.getByPlaceholder('Email').fill(STAFF.email);
  await page.getByPlaceholder('Password').fill(STAFF.password);
  await page.getByRole('button', { name: /Unlock settings/i }).click();
  await expect(page.getByText(/Only managers can change settings/i)).toBeVisible({ timeout: 20_000 });
  // never reached the options screen ("Signed in as …" only renders once unlocked)
  await expect(page.getByText(/Signed in as/i)).toHaveCount(0);
  await expect(page.getByTestId('kiosk-company')).toHaveCount(0);
});

test('a manager can set the restaurant and it persists', async ({ page }) => {
  await openLoginGate(page);
  await page.getByPlaceholder('Email').fill(MGR.email);
  await page.getByPlaceholder('Password').fill(MGR.password);
  await page.getByRole('button', { name: /Unlock settings/i }).click();

  await expect(page.getByText(/Tablet settings/i)).toBeVisible({ timeout: 20_000 });

  // pick What a Jerk if offered, otherwise the first restaurant in the list
  const companies = page.getByTestId('kiosk-company');
  await expect(companies.first()).toBeVisible({ timeout: 20_000 });
  const waj = companies.filter({ hasText: /What a Jerk/i });
  const target = (await waj.count()) ? waj.first() : companies.first();
  await target.click();

  await expect(page.getByText(/Set this tablet to/i)).toBeVisible();
  await page.getByRole('button', { name: /Yes, switch restaurant/i }).click();
  await expect(page.getByText('● Current')).toBeVisible();

  // close settings → the clock grid for that company (or its empty state)
  await page.getByRole('button', { name: /^Done$/ }).click();
  await expect(
    page.getByText(/Tap your name to clock in or out|No staff set up for the clock yet/i),
  ).toBeVisible({ timeout: 20_000 });

  // reload → still configured (no "not set up")
  await page.reload();
  await expect(page.getByText('This tablet is not set up yet')).toHaveCount(0);
});
