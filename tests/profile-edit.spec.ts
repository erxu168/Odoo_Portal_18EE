import { test, expect } from '@playwright/test';

/**
 * UI coverage for the manager full-profile editor: open a staff member,
 * "Edit full profile", set a field on the Personal step and one on the
 * Residence & work step, and confirm both persist (round-trip through Odoo).
 * Seeds + deletes a throwaway employee.
 */
const STAMP = process.env.SMOKE_STAMP || String(Date.now());
const NAME = `ZZ PW Profile ${STAMP} DELETE`;
const BIRTHDAY = '1990-05-15';
const VISA = '2028-12-31';

test('manager edits an employee full profile', async ({ page }) => {
  page.on('response', (r) => { if (/\/api\/hr\/employee\/\d+/.test(r.url())) console.log('[resp]', r.request().method(), r.status(), r.url()); });

  const deps = (await (await page.request.get('/api/hr/departments')).json()).departments || [];
  const dep = deps.find((d: { company_id: number | null }) => d.company_id) || deps[0];
  const cr = await page.request.post('/api/hr/employees', { data: { name: NAME, company_id: dep.company_id, department_id: dep.id } });
  expect(cr.ok()).toBeTruthy();
  const empId = (await cr.json()).employee.id as number;

  await page.goto('/hr');
  await page.getByText('View all staff').click();
  await page.getByPlaceholder('Search employees...').fill(NAME);
  await page.getByRole('button', { name: NAME }).first().click();

  await page.getByRole('button', { name: /edit full profile/i }).click();

  // Step 1 — Personal: set birthday, Continue.
  const bday = page.locator('input[type="date"]').first();
  await expect(bday).toBeVisible({ timeout: 20_000 });
  await bday.fill(BIRTHDAY);
  await page.getByRole('button', { name: /^continue$/i }).click();

  // Step 2 — Tax: Continue.
  await page.getByRole('button', { name: /^continue$/i }).click();

  // Step 3 — Insurance: tick the required confirmation, then Continue.
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /^continue$/i }).click();

  // Step 4 — Bank: Continue (no IBAN).
  await page.getByRole('button', { name: /^continue$/i }).click();

  // Step 5 — Residence & work: set Visa expires, Save & finish.
  const visa = page.locator('label').filter({ hasText: 'Visa expires' }).locator('input');
  await expect(visa).toBeVisible({ timeout: 20_000 });
  await visa.fill(VISA);
  await page.getByRole('button', { name: /save & finish/i }).click();

  // Verify persistence via the scoped GET.
  await expect.poll(async () => {
    const e = (await (await page.request.get('/api/hr/employee/' + empId)).json()).employee;
    return e && e.birthday === BIRTHDAY && e.visa_expire === VISA;
  }, { timeout: 25_000 }).toBe(true);
});
