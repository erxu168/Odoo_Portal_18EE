import { test, expect } from '@playwright/test';

/**
 * UI (browser) coverage for Phase 2 staff management: Departments & Roles.
 * HR -> Departments & Roles -> add a department, add a role, archive the
 * department (leaves the active list, shows under "Show archived"), restore it.
 *
 * Creates uniquely-named throwaway records; they are removed from Odoo
 * out-of-band after the run (0-member depts/roles can be hard-deleted).
 */
const STAMP = process.env.SMOKE_STAMP || String(Date.now());
const DEPT = `ZZ PW Dept ${STAMP}`;
const ROLE = `ZZ PW Role ${STAMP}`;

test('manage departments & roles through the UI', async ({ page }) => {
  page.on('dialog', (d) => d.accept()); // auto-accept archive confirm()

  await page.goto('/hr');

  // Open the Departments & Roles screen via the manager tile.
  const tile = page.getByText('Departments & Roles', { exact: true });
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await tile.click();

  // --- Add a department ---
  await page.getByRole('button', { name: /add department/i }).click();
  await expect(page.getByPlaceholder('e.g. Kitchen')).toBeVisible();
  await page.getByPlaceholder('e.g. Kitchen').fill(DEPT);
  await page.locator('select').first().selectOption({ index: 1 }); // restaurant
  await page.getByRole('button', { name: /add department/i }).click();

  // Back on the list — the new department appears.
  await expect(page.getByText(DEPT).first()).toBeVisible({ timeout: 20_000 });

  // --- Add a role ---
  await page.getByRole('button', { name: 'Roles', exact: true }).click();
  await page.getByRole('button', { name: /add role/i }).click();
  await expect(page.getByPlaceholder('e.g. Line Cook')).toBeVisible();
  await page.getByPlaceholder('e.g. Line Cook').fill(ROLE);
  await page.locator('select').first().selectOption({ index: 1 }); // restaurant
  await page.getByRole('button', { name: /add role/i }).click();

  // Back on the list — remount defaults to the Departments tab; switch to Roles to verify.
  await page.getByRole('button', { name: 'Roles', exact: true }).click();
  await expect(page.getByText(ROLE).first()).toBeVisible({ timeout: 20_000 });

  // --- Archive the department ---
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await page.getByText(DEPT).first().click();
  await expect(page.getByRole('button', { name: /archive this department/i })).toBeVisible();
  await page.getByRole('button', { name: /archive this department/i }).click();

  // It should be gone from the default (active) list...
  await expect(page.getByText(DEPT)).toHaveCount(0, { timeout: 20_000 });
  // ...and reappear when showing archived.
  await page.getByRole('button', { name: /show archived/i }).click();
  await expect(page.getByText(DEPT).first()).toBeVisible({ timeout: 20_000 });

  // --- Restore it ---
  await page.getByText(DEPT).first().click();
  await expect(page.getByRole('button', { name: /restore this department/i })).toBeVisible();
  await page.getByRole('button', { name: /restore this department/i }).click();

  // Back on the default list (remount clears the archived toggle) — it is active again.
  await expect(page.getByText(DEPT).first()).toBeVisible({ timeout: 20_000 });
});
