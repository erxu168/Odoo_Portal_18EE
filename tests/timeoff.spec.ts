import { test, expect } from '@playwright/test';

/**
 * UI (browser) coverage for Phase 4: Time Off.
 * Seeds a throwaway employee, then through the UI:
 * books Sick leave (no allocation needed) on their behalf, sees it pending,
 * approves it, and confirms it moves to Approved.
 *
 * The employee + leave are removed from Odoo out-of-band after the run.
 */
const STAMP = process.env.SMOKE_STAMP || String(Date.now());
const NAME = `ZZ PW TimeOff ${STAMP} DELETE`;
const LEAVE_DATE = '2026-07-20'; // a Monday, safely in the future

test('book & approve time off through the UI', async ({ page }) => {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('response', (r) => {
    if (r.url().includes('/timeoff')) console.log('[resp]', r.request().method(), r.status(), r.url());
  });

  // --- Seed a throwaway employee via the API ---
  const depsRes = await page.request.get('/api/hr/departments');
  const deps = (await depsRes.json()).departments || [];
  const dep = deps.find((d: { company_id: number | null }) => d.company_id) || deps[0];
  expect(dep, 'need a department to seed an employee').toBeTruthy();
  const createRes = await page.request.post('/api/hr/employees', {
    data: { name: NAME, company_id: dep.company_id, department_id: dep.id },
  });
  expect(createRes.ok()).toBeTruthy();
  const empId = (await createRes.json()).employee.id;

  // Find a genuinely bookable (no-allocation) leave type for this employee.
  const typesJson = await (await page.request.get(`/api/hr/timeoff/types?employee_id=${empId}`)).json();
  const bookable = (typesJson.types || []).find((t: { requires_allocation: boolean }) => !t.requires_allocation)
    || (typesJson.types || [])[0];
  expect(bookable, 'employee should have at least one bookable leave type').toBeTruthy();

  // --- Open Time Off ---
  await page.goto('/hr');
  const tile = page.getByText('Time Off', { exact: true });
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await tile.click();

  // --- Request time off on their behalf ---
  await page.getByRole('button', { name: /request time off/i }).click();
  await expect(page.getByText('Staff member', { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.locator('select').first().selectOption({ label: NAME }); // staff member

  // Type options load after the employee is chosen — pick the bookable (no-allocation) type.
  const typeSelect = page.locator('select').nth(1);
  await expect.poll(async () => typeSelect.locator('option').count()).toBeGreaterThan(1);
  await typeSelect.selectOption(String(bookable.id));

  await page.locator('input[type="date"]').first().fill(LEAVE_DATE);
  await page.locator('input[type="date"]').nth(1).fill(LEAVE_DATE);
  await page.getByRole('button', { name: /create request/i }).click();

  // --- Back on the list (To review) — our request is pending ---
  const card = page.locator('div.rounded-2xl').filter({ hasText: NAME });
  await expect(card.first()).toBeVisible({ timeout: 20_000 });

  // --- Approve it ---
  await card.getByRole('button', { name: /approve/i }).first().click();

  // It should leave the pending list...
  await expect(page.getByText(NAME)).toHaveCount(0, { timeout: 20_000 });

  // ...and show as Approved under "All".
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const allCard = page.locator('div.rounded-2xl').filter({ hasText: NAME });
  await expect(allCard.first()).toBeVisible({ timeout: 20_000 });
  await expect(allCard.first()).toContainText(/approved/i);
});
