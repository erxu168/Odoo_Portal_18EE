import { test, expect, Page } from '@playwright/test';

/**
 * e2e: the bank account-holder name (hr.employee.de_bank_account_holder) saves and
 * round-trips, and a holder-only change leaves the IBAN intact. Runs against
 * staging (self-login manager).
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const STAMP = process.env.SMOKE_STAMP || String(Date.now());
const IBAN = 'DE89 3704 0044 0532 0130 00';

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

test('bank account holder saves, and a holder-only change keeps the IBAN', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  const empId = await seedEmployee(page, `ZZ PW Holder ${STAMP} DELETE`);

  // Save IBAN + holder together.
  const r1 = await page.request.post('/api/hr/bank', { data: { employee_id: empId, iban: IBAN, accountHolder: 'Maria Musterfrau' } });
  expect(r1.ok(), `save 1 failed: ${JSON.stringify(await r1.json())}`).toBeTruthy();
  const g1 = await (await page.request.get(`/api/hr/bank?employee_id=${empId}`)).json();
  expect(g1.accountHolder).toBe('Maria Musterfrau');
  expect((g1.iban || '').replace(/\s/g, '')).toBe(IBAN.replace(/\s/g, ''));

  // Change only the holder (no IBAN) — IBAN must be preserved.
  const r2 = await page.request.post('/api/hr/bank', { data: { employee_id: empId, accountHolder: 'Hans Muster' } });
  expect(r2.ok(), `save 2 failed: ${JSON.stringify(await r2.json())}`).toBeTruthy();
  const g2 = await (await page.request.get(`/api/hr/bank?employee_id=${empId}`)).json();
  expect(g2.accountHolder).toBe('Hans Muster');
  expect((g2.iban || '').replace(/\s/g, '')).toBe(IBAN.replace(/\s/g, ''));
});
