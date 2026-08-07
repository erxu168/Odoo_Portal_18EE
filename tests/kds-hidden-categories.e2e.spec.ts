import { test, expect } from '@playwright/test';

/**
 * KDS Settings -> "Show in Kitchen": the manager unticks a menu category and the
 * kitchen stops seeing it. Built for self-service drinks (Ethan, 2026-08-07).
 *
 * /kds is a no-login kitchen-tablet route, so this drives the real screen with no
 * sign-in. READ-ONLY: the panel is opened and inspected but never SAVED, so the
 * live KDS configuration is not touched by the test run.
 */

// The KDS is a landscape kitchen tablet, not a phone.
test.use({ viewport: { width: 1280, height: 800 } });

test('the Show in Kitchen list offers every menu category on the register', async ({ page }) => {
  await page.goto('/kds');
  // The settings arrive after first paint; the panel shows factory defaults
  // until they do. Wait for the real ones rather than racing them.
  await page.waitForResponse(r => r.url().includes('/api/kds/settings') && r.ok());

  // Settings live behind the gear in the top bar.
  const gear = page.locator('.kds-settings-panel');
  await expect(gear).toHaveCount(0); // closed to begin with

  await page.getByRole('button', { name: /settings|⚙/i }).first().click();
  await expect(page.locator('.kds-settings-panel')).toBeVisible();

  const section = page.locator('.kds-settings-section', { hasText: 'Show in Kitchen' });
  await expect(section).toBeVisible();

  // The eight What a Jerk categories, drinks among them.
  for (const name of ['Burgers', 'Wraps', 'Signature Jerk', 'Deep Fried', 'Patties', 'Sides', 'Sauces', 'WAJ Drinks']) {
    await expect(section.getByText(name, { exact: true })).toBeVisible();
  }
});

test('a category toggle flips without saving, and food categories are independent', async ({ page }) => {
  await page.goto('/kds');
  // The settings arrive after first paint; the panel shows factory defaults
  // until they do. Wait for the real ones rather than racing them.
  await page.waitForResponse(r => r.url().includes('/api/kds/settings') && r.ok());
  await page.getByRole('button', { name: /settings|⚙/i }).first().click();

  const section = page.locator('.kds-settings-section', { hasText: 'Show in Kitchen' });
  await expect(section).toBeVisible();

  const drinksRow = section.locator('.kds-settings-row', { hasText: 'WAJ Drinks' });
  const burgersRow = section.locator('.kds-settings-row', { hasText: 'Burgers' });
  const drinksToggle = drinksRow.locator('button');
  const burgersToggle = burgersRow.locator('button');

  const before = await drinksToggle.evaluate(el => getComputedStyle(el).backgroundColor);
  const burgersBefore = await burgersToggle.evaluate(el => getComputedStyle(el).backgroundColor);

  await drinksToggle.click();
  await expect
    .poll(() => drinksToggle.evaluate(el => getComputedStyle(el).backgroundColor))
    .not.toBe(before);

  // Ticking drinks must not disturb any other category.
  expect(await burgersToggle.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(burgersBefore);

  // Leave without saving — the live configuration stays exactly as it was.
  await page.locator('.kds-settings-overlay').click();
  await expect(page.locator('.kds-settings-panel')).toHaveCount(0);
});
