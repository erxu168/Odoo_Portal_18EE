import { test, expect, Page } from '@playwright/test';

/**
 * Waste Tracker e2e — drives the real /waste screen in a browser against
 * staging. Logs in itself (manager + shared tablet), same env/fallback scheme
 * as inventory.e2e.spec.ts.
 *
 * The record-and-undo test leaves no trace: whatever it bins, it un-bins (a
 * soft delete), so the consumption numbers are untouched.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const TAB = {
  email: process.env.SMOKE_TABLET_EMAIL || 'waj-kitchen@krawings.de',
  password: process.env.SMOKE_TABLET_PASSWORD || 'WajKitchen#2026',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('manager: record a waste entry, see it instantly, undo it', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await page.goto('/waste');

  // The screen and its one non-negotiable rule.
  await expect(page.getByText('Something binned').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Raw ingredients only/i)).toBeVisible();

  // Find a product. "Sal" matches Salt/Salz/Salat in the WAJ lists.
  await page.getByPlaceholder(/Search what went in the bin/i).fill('Sal');
  const cell = page.locator('button', { hasText: /Sal/i }).first();
  await expect(cell).toBeVisible({ timeout: 15_000 });
  await cell.click();

  // Quantity: plain numpad (tap 2) or crate sheet (bump a stepper) — both end
  // in the same green "Bin it".
  const two = page.locator('button', { hasText: /^2$/ }).first();
  if (await two.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await two.click();
  } else {
    await page.locator('button', { hasText: '+' }).first().click();
  }
  await page.getByRole('button', { name: 'Bin it' }).click();

  // The optional why-screen: WALK AWAY — the entry must already be saved.
  await expect(page.getByText(/already saved/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Close' }).click();

  // Immediate feedback: the day list shows it without any refresh.
  await expect(page.getByText('Binned today')).toBeVisible({ timeout: 10_000 });
  const rowUndo = page.locator('button', { hasText: 'Undo' }).last();
  await expect(rowUndo).toBeVisible();

  // Undo — and the row leaves the screen at once.
  const rowsBefore = await page.locator('button', { hasText: 'Undo' }).count();
  await rowUndo.click();
  await expect
    .poll(async () => page.locator('button', { hasText: 'Undo' }).count(), { timeout: 10_000 })
    .toBeLessThan(rowsBefore);
});

test('manager: waste settings sheet lists departments with the photo switch', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await page.goto('/waste');
  await page.getByRole('button', { name: 'Waste settings' }).click();
  await expect(page.getByText('Photo required').first()).toBeVisible({ timeout: 15_000 });
  // The warning that explains why the default is off.
  await expect(page.getByText(/fails silently/i)).toBeVisible();
});

test('manager: the usage report explains the binned term', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await page.goto('/inventory');
  await page.locator('button', { hasText: 'Consumption' }).first().click();
  await expect(page.getByText(/binned/i).first()).toBeVisible({ timeout: 15_000 });
});

test('shared tablet: the station home offers the Something binned tile behind the PIN gate', async ({ page }) => {
  await login(page, TAB.email, TAB.password);
  // The tile is on the home grid; the PIN gate (rightly) stands in front of
  // it — work on a shared tablet must be credited to a person, so this test
  // asserts presence + the gate, not a click-through (PINs aren't in fixtures).
  const tile = page.locator('button', { hasText: 'Something binned' }).first();
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Kitchen Station').first()).toBeVisible({ timeout: 10_000 });
});
