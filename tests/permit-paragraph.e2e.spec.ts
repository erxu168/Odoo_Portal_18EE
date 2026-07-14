import { test, expect, Page } from '@playwright/test';

/**
 * e2e for Part 3: the exact residence-permit paragraph field
 * (hr.employee.kw_aufenthaltstitel_paragraph) saves and round-trips through Odoo.
 * Runs against staging via the `modules` project (self-login manager).
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const STAMP = process.env.SMOKE_STAMP || String(Date.now());
const PARA = '§ 16b Abs. 3 AufenthG';

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
  const res = await page.request.post('/api/hr/employees', {
    data: { name, company_id: dep.company_id, department_id: dep.id },
  });
  expect(res.ok(), 'seed employee').toBeTruthy();
  return (await res.json()).employee?.id;
}

async function openResidence(page: Page, name: string) {
  await page.goto('/hr');
  await page.getByText('Employees', { exact: true }).first().click();
  const box = page.getByPlaceholder('Search employees...');
  await expect(box).toBeVisible({ timeout: 20_000 });
  await box.fill(name);
  await page.getByText(name).first().click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByText('Residence & work', { exact: true }).click();
}

test('exact permit paragraph saves and round-trips', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  const name = `ZZ PW Para ${STAMP} DELETE`;
  await seedEmployee(page, name);

  await openResidence(page, name);
  await page.locator('select').filter({ hasText: 'Temporary residence permit' }).selectOption('befristet');
  const para = page.getByPlaceholder('e.g. § 16b Abs. 3 AufenthG');
  await expect(para).toBeVisible({ timeout: 20_000 });
  await para.fill(PARA);
  await page.getByRole('button', { name: /^Save$/ }).click();

  // Reopen fresh; the paragraph persisted through Odoo.
  await openResidence(page, name);
  await expect(page.getByPlaceholder('e.g. § 16b Abs. 3 AufenthG')).toHaveValue(PARA, { timeout: 20_000 });
});
