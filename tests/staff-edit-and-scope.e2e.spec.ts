import { test, expect, Page } from '@playwright/test';

/**
 * e2e for two changes, run against staging via the `modules` project (self-login,
 * mobile viewport):
 *   1. Employees list follows the header company — the in-list company/department
 *      filter dropdowns are gone; search + status badges remain.
 *   2. Staff detail = one tap-to-edit flow — the old "Edit full profile" / "Edit
 *      basics" buttons are gone; an Edit toggle reveals tappable sections that open
 *      focused section editors.
 * Manager creds fall back to the staging test account.
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

async function openEmployees(page: Page) {
  await page.goto('/hr');
  await page.getByText('Employees', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search employees...')).toBeVisible({ timeout: 20_000 });
}

test('Employees list: no company/department filter dropdowns, follows header company', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await openEmployees(page);

  // The redundant filter row is gone.
  await expect(page.getByText('All companies')).toHaveCount(0);
  await expect(page.getByText('All departments')).toHaveCount(0);

  // Search + status badges remain.
  await expect(page.getByPlaceholder('Search employees...')).toBeVisible();
  await expect(page.getByText(/^All \(\d+\)/)).toBeVisible();
});

test('Staff detail: single Edit mode replaces the two edit buttons and opens section editors', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await openEmployees(page);

  // Open the first staff member (rows show an onboarding "%"; badges do not).
  const firstEmployee = page.locator('button', { hasText: '%' }).first();
  await expect(firstEmployee).toBeVisible({ timeout: 20_000 });
  await firstEmployee.click();

  // Old buttons gone; single Edit toggle present.
  await expect(page.getByText('Edit full profile')).toHaveCount(0);
  await expect(page.getByText('Edit basics (name, role, contact)')).toHaveCount(0);
  const editToggle = page.getByRole('button', { name: 'Edit', exact: true });
  await expect(editToggle).toBeVisible({ timeout: 20_000 });

  // Enter edit mode.
  await editToggle.click();
  await expect(page.getByText('Tap any section or document to edit')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();

  // Tap the Tax section (a tappable card in edit mode) → focused Tax editor with a Save button.
  await page.getByRole('button').filter({ hasText: 'Tax class' }).first().click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({ timeout: 20_000 });
});
