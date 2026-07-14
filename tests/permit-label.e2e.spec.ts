import { test, expect, Page } from '@playwright/test';

/**
 * e2e: the residence-permit type shows its friendly label (not the raw Odoo key)
 * in the manager's EmployeeDetail read view. Runs against staging (self-login mgr).
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
  const res = await page.request.post('/api/hr/employees', {
    data: { name, company_id: dep.company_id, department_id: dep.id },
  });
  expect(res.ok(), 'seed employee').toBeTruthy();
  return (await res.json()).employee?.id;
}

async function openEmployee(page: Page, name: string) {
  await page.goto('/hr');
  await page.getByText('Employees', { exact: true }).first().click();
  const box = page.getByPlaceholder('Search employees...');
  await expect(box).toBeVisible({ timeout: 20_000 });
  await box.fill(name);
  await page.getByText(name).first().click();
}

test('permit type displays the friendly label, not the raw key', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  const name = `ZZ PW Label ${STAMP} DELETE`;
  await seedEmployee(page, name);

  // Set permit type = befristet via the Residence & work section.
  await openEmployee(page, name);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByText('Residence & work', { exact: true }).click();
  await page.locator('select').filter({ hasText: 'Temporary residence permit' }).selectOption('befristet');
  await page.getByRole('button', { name: /^Save$/ }).click();

  // Detail read view shows the friendly label, and never the raw key "befristet".
  await openEmployee(page, name);
  await expect(page.getByText('Temporary residence permit (Aufenthaltserlaubnis)')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('befristet', { exact: true })).toHaveCount(0);
});
