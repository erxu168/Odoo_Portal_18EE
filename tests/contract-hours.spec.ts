import { test, expect } from '@playwright/test';

/**
 * UI (browser) coverage for Phase 3: Contract & hours.
 * Creates a throwaway employee via the API, then through the UI:
 * opens their Contract & hours, creates a contract (hours + pay, admin session),
 * saves, reopens, and verifies the values persisted round-trip through Odoo.
 *
 * The employee + contract are removed from Odoo out-of-band after the run.
 */
const STAMP = process.env.SMOKE_STAMP || String(Date.now());
const NAME = `ZZ PW Contract ${STAMP} DELETE`;

test('create & edit a contract through the UI (admin sees pay)', async ({ page }) => {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('response', (r) => {
    if (r.url().includes('/contract')) console.log('[resp]', r.request().method(), r.status(), r.url());
  });
  // --- Seed a throwaway employee via the API (session comes from storageState) ---
  const depsRes = await page.request.get('/api/hr/departments');
  const deps = (await depsRes.json()).departments || [];
  const dep = deps.find((d: { company_id: number | null }) => d.company_id) || deps[0];
  expect(dep, 'need at least one department to seed an employee').toBeTruthy();
  const createRes = await page.request.post('/api/hr/employees', {
    data: { name: NAME, company_id: dep.company_id, department_id: dep.id },
  });
  expect(createRes.ok()).toBeTruthy();

  // --- Navigate to the employee ---
  await page.goto('/hr');
  await page.getByText('View all staff').click();
  const searchBox = page.getByPlaceholder('Search employees...');
  await expect(searchBox).toBeVisible({ timeout: 20_000 });
  await searchBox.fill(NAME);
  await page.getByText(NAME).first().click();

  // --- Open Contract & hours ---
  const contractBtn = page.getByRole('button', { name: /contract .* hours/i });
  await expect(contractBtn).toBeVisible({ timeout: 20_000 });
  await contractBtn.click();

  // New employee => no contract yet.
  await expect(page.getByText(/no contract on file yet/i)).toBeVisible({ timeout: 20_000 });
  // Admin session => the pay card is present.
  await expect(page.getByText(/pay \(admins only\)/i)).toBeVisible();

  // --- Fill and create ---
  await page.getByPlaceholder('e.g. 20').fill('24');   // hours / week
  await page.getByPlaceholder('e.g. 5').fill('4');     // days / week
  await page.getByPlaceholder('e.g. 13.90').fill('14.5'); // hourly rate (admin)
  await page.getByRole('button', { name: /create contract/i }).click();

  // Back on the employee page; reopen the contract screen.
  await expect(contractBtn).toBeVisible({ timeout: 20_000 });
  await contractBtn.click();

  // --- Verify persistence (round-trip through Odoo) ---
  await expect(page.getByPlaceholder('e.g. 20')).toHaveValue('24', { timeout: 20_000 });
  await expect(page.getByPlaceholder('e.g. 5')).toHaveValue('4');
  await expect(page.getByPlaceholder('e.g. 13.90')).toHaveValue('14.5');
  // It should now be an existing contract (Save, not Create).
  await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible();
});
