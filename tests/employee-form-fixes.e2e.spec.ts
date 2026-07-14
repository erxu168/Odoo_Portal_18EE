import { test, expect, Page } from '@playwright/test';

/**
 * e2e for two employee-form fixes, run against staging via the `modules` project
 * (self-login as a manager, mobile viewport):
 *   1. IBAN / bank save — was crashing with "Invalid field 'address_home_id' on
 *      model 'hr.employee'" (removed in Odoo 18). Now attaches to work_contact_id.
 *   2. Permit type — was a free-text box bound to the Odoo Selection field
 *      kw_aufenthaltstitel_typ, so typing e.g. "§ 16b Abs. 3 AufenthG" errored with
 *      "Wrong value for ...". Now a dropdown of the valid keys.
 *
 * Throwaway employees are named "ZZ ... DELETE" and cleaned up out-of-band.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const STAMP = process.env.SMOKE_STAMP || String(Date.now());

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

async function seedEmployee(page: Page, name: string): Promise<number> {
  const deps = (await (await page.request.get('/api/hr/departments')).json()).departments || [];
  const dep = deps.find((d: { company_id: number | null }) => d.company_id) || deps[0];
  expect(dep, 'need a department to seed an employee').toBeTruthy();
  const res = await page.request.post('/api/hr/employees', {
    data: { name, company_id: dep.company_id, department_id: dep.id },
  });
  expect(res.ok(), 'seed employee').toBeTruthy();
  const id = (await res.json()).employee?.id;
  expect(id, 'create returned employee.id').toBeTruthy();
  return id;
}

test('IBAN saves via work_contact_id (no address_home_id crash)', async ({ page }) => {
  page.on('response', (r) => { if (r.url().includes('/api/hr/bank')) console.log('[bank]', r.request().method(), r.status()); });
  await login(page, MGR.email, MGR.password);
  const empId = await seedEmployee(page, `ZZ PW Bank ${STAMP} DELETE`);

  // Save a valid German IBAN through the same API the form uses.
  const IBAN = 'DE89 3704 0044 0532 0130 00'; // canonical valid test IBAN (passes mod-97)
  const save = await page.request.post('/api/hr/bank', { data: { iban: IBAN, employee_id: empId } });
  const body = await save.json();
  expect(save.ok(), `bank save failed: ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.success).toBeTruthy();

  // Round-trips back through Odoo.
  const get = await page.request.get(`/api/hr/bank?employee_id=${empId}`);
  const got = await get.json();
  expect((got.iban || '').replace(/\s+/g, '')).toBe(IBAN.replace(/\s+/g, ''));
});

test('Permit type is a dropdown of valid keys (no free-text "Wrong value" crash)', async ({ page }) => {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await login(page, MGR.email, MGR.password);
  const name = `ZZ PW Permit ${STAMP} DELETE`;
  await seedEmployee(page, name);

  // Open the employee → Edit mode → Residence & work section.
  await page.goto('/hr');
  await page.getByText('Employees', { exact: true }).first().click();
  const searchBox = page.getByPlaceholder('Search employees...');
  await expect(searchBox).toBeVisible({ timeout: 20_000 });
  await searchBox.fill(name);
  await page.getByText(name).first().click();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByText('Residence & work', { exact: true }).click();

  // Permit type is now a <select> (combobox), not a free-text input.
  const permit = page.locator('select').filter({ hasText: 'Temporary residence permit' });
  await expect(permit).toBeVisible({ timeout: 20_000 });
  await permit.selectOption('befristet'); // the § 16b student case maps here

  await page.getByRole('button', { name: /^Save$/ }).click();

  // Success = we return to the detail with NO Odoo error banner.
  await expect(page.getByText(/Odoo RPC Error|Wrong value for/i)).toHaveCount(0);
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
});
