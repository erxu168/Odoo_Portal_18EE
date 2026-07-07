import { test, expect, Page } from '@playwright/test';

/**
 * e2e for "Start a new contract" (renewal) + editable contract history on the
 * Contract & hours screen. Runs against staging via the `modules` project
 * (self-login as a manager, mobile viewport).
 *
 * Flow: seed a throwaway employee + one running contract via the API, then through
 * the UI start a new contract, confirm, and verify the old one is kept as an "Ended"
 * history row while the new one is "Running" with the hours carried forward.
 *
 * The employee + contracts are named "ZZ ... DELETE" and cleaned up out-of-band.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const STAMP = process.env.SMOKE_STAMP || String(Date.now());
const NAME = `ZZ PW Renew ${STAMP} DELETE`;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('renew a contract: old one becomes Ended history, new one is Running', async ({ page }) => {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('response', (r) => {
    if (r.url().includes('/contract')) console.log('[resp]', r.request().method(), r.status(), r.url());
  });

  await login(page, MGR.email, MGR.password);

  // --- Seed a throwaway employee in the manager's company (JSON read once) ---
  const depsRes = await page.request.get('/api/hr/departments');
  const deps = (await depsRes.json()).departments || [];
  const dep = deps.find((d: { company_id: number | null }) => d.company_id) || deps[0];
  expect(dep, 'need a department to seed an employee').toBeTruthy();
  const createRes = await page.request.post('/api/hr/employees', {
    data: { name: NAME, company_id: dep.company_id, department_id: dep.id },
  });
  expect(createRes.ok(), 'seed employee').toBeTruthy();

  // --- Open the new employee's Contract & hours screen ---
  await page.goto('/hr');
  await page.getByText('Employees', { exact: true }).first().click();
  const searchBox = page.getByPlaceholder('Search employees...');
  await expect(searchBox).toBeVisible({ timeout: 20_000 });
  await searchBox.fill(NAME);
  await page.getByText(NAME).first().click();

  const contractBtn = page.getByRole('button', { name: /contract .* hours/i });
  await expect(contractBtn).toBeVisible({ timeout: 20_000 });
  await contractBtn.click();

  // --- Create the initial contract via the UI: start 01.01.2025, 30 h/week ---
  await expect(page.getByText(/no contract on file yet/i)).toBeVisible({ timeout: 20_000 });
  await page.locator('input[type="date"]').first().fill('2025-01-01'); // Start date
  await page.getByPlaceholder('e.g. 20').fill('30');                   // hours / week
  await page.getByPlaceholder('e.g. 5').fill('5');                     // days / week
  await page.getByRole('button', { name: /create contract/i }).click();

  // Back on the employee page; reopen the contract screen.
  await expect(contractBtn).toBeVisible({ timeout: 20_000 });
  await contractBtn.click();

  // One contract only => no history card yet, and the hours round-tripped.
  await expect(page.getByPlaceholder('e.g. 20')).toHaveValue('30', { timeout: 20_000 });
  await expect(page.getByText('Contract history')).toHaveCount(0);

  // --- Start a new contract ---
  await page.getByRole('button', { name: /start a new contract/i }).click();
  // Renewal note appears; the primary button switches to "Create new contract".
  await expect(page.getByText(/starting a new contract/i)).toBeVisible();
  const createNew = page.getByRole('button', { name: /create new contract/i });
  await expect(createNew).toBeVisible();
  await createNew.click();

  // --- Confirmation gate (no skipping) ---
  await expect(page.getByText('Start a new contract?')).toBeVisible();
  await page.getByRole('button', { name: /yes, start new contract/i }).click();

  // --- Verify: history now has the old (Ended) + new (Running) contracts ---
  await expect(page.getByText('Contract history')).toBeVisible({ timeout: 20_000 });

  // The old contract row (started 01.01.2025) is now Ended with an end date set.
  const oldRow = page.getByRole('button').filter({ hasText: '01.01.2025' });
  await expect(oldRow).toBeVisible();
  await expect(oldRow.getByText('Ended')).toBeVisible();
  await expect(oldRow).not.toContainText('ongoing');

  // Exactly one Running badge in the history (the new contract).
  await expect(page.getByText('Running', { exact: true })).toHaveCount(1);

  // The new (current) contract carried the 30 h/week forward.
  await expect(page.getByPlaceholder('e.g. 20')).toHaveValue('30');
});
