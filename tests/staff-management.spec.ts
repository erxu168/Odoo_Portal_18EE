import { test, expect } from '@playwright/test';

/**
 * UI (browser) coverage for Phase 1 staff management:
 * HR -> Employees -> Add staff -> lands on the new employee with the
 * Edit / Offboard / Mark-as-left actions.
 *
 * Creates a uniquely-named throwaway record; it is removed from Odoo
 * out-of-band after the run.
 */
const STAMP = process.env.SMOKE_STAMP || String(Date.now());
const NAME = `ZZ Playwright ${STAMP} DELETE`;

test('add a staff member through the UI', async ({ page }) => {
  // Auto-accept any confirm() dialog (e.g. Mark as left).
  page.on('dialog', (d) => d.accept());

  await page.goto('/hr');

  // Open the Employees screen via the manager tile.
  await expect(page.getByText('View all staff')).toBeVisible({ timeout: 20_000 });
  await page.getByText('View all staff').click();

  // The Add-staff button is always present on the list.
  const addBtn = page.getByRole('button', { name: /add staff/i });
  await expect(addBtn).toBeVisible({ timeout: 15_000 });
  await addBtn.click();

  // Fill the form.
  await expect(page.getByPlaceholder('e.g. Maria Schmidt')).toBeVisible();
  await page.getByPlaceholder('e.g. Maria Schmidt').fill(NAME);

  const selects = page.locator('select');
  await selects.nth(0).selectOption({ index: 1 }); // restaurant (first real option)
  // Department options load after a restaurant is chosen.
  await expect.poll(async () => selects.nth(1).locator('option').count()).toBeGreaterThan(1);
  await selects.nth(1).selectOption({ index: 1 }); // department

  await page.getByPlaceholder('e.g. Kitchen Assistant').fill('Playwright Tester');

  // Submit.
  await page.getByRole('button', { name: /add staff member/i }).click();

  // Should land on the new employee's detail page with the management actions.
  await expect(page.getByText(NAME).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /edit details/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /offboard/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /mark as left/i })).toBeVisible();
});
