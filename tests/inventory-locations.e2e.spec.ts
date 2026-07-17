import { test, expect, Page } from '@playwright/test';

/**
 * Guided Inventory — Phase 1 (location layer) e2e.
 * Drives the real manager location-setup screen against staging.
 * Creds mirror tests/inventory.e2e.spec.ts (env with staging fallback).
 *   SMOKE_MANAGER_EMAIL / SMOKE_MANAGER_PASSWORD
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}
const tile = (page: Page, label: string) => page.locator('button', { hasText: label }).first();

test('manager can create a count location, and it persists across reload', async ({ page }) => {
  const areaName = `E2E Area ${Date.now()}`;
  await login(page, MGR.email, MGR.password);
  await page.goto('/inventory');

  await tile(page, 'Locations').click();
  await expect(page.getByRole('heading', { name: /^Locations$/ })).toBeVisible({ timeout: 25_000 });

  // Create an area
  await page.getByRole('button', { name: /Add an area/i }).click();
  await page.getByPlaceholder('e.g. Walk-in Fridge').fill(areaName);
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(page.getByText(areaName)).toBeVisible({ timeout: 15_000 });

  // Reload — the area came from the server, so it survives
  await page.reload();
  await tile(page, 'Locations').click();
  await expect(page.getByText(areaName)).toBeVisible({ timeout: 25_000 });

  // Cleanup: remove the test area (accept the confirm dialog)
  page.on('dialog', (d) => d.accept());
  const card = page.locator('div', { hasText: areaName }).last();
  await card.getByRole('button', { name: /^Edit$/ }).first().click();
  await page.getByRole('button', { name: /Remove this location/i }).click();
  await expect(page.getByText(areaName)).toHaveCount(0, { timeout: 15_000 });
});
