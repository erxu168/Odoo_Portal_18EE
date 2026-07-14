import { test, expect, Page } from '@playwright/test';

/**
 * e2e for Part 1 of the onboarding-documents work (run against staging via the
 * `modules` project, self-login manager):
 *   1. Four new document types exist; the two student-only ones (Enrollment
 *      certificate, Student ID) appear ONLY after a manager ticks "Working
 *      student" on the person's Residence & work section. The two always-on ones
 *      (Health Insurance card, Address registration) show for everyone.
 *   2. A new type uploads and round-trips with its freshly-created Odoo tag.
 *
 * Throwaway employees named "ZZ ... DELETE" — cleaned up out-of-band.
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

async function openEmployee(page: Page, name: string) {
  await page.goto('/hr');
  await page.getByText('Employees', { exact: true }).first().click();
  const searchBox = page.getByPlaceholder('Search employees...');
  await expect(searchBox).toBeVisible({ timeout: 20_000 });
  await searchBox.fill(name);
  await page.getByText(name).first().click();
}

test('"Working student" toggle reveals the student-only documents', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  const name = `ZZ PW Student ${STAMP} DELETE`;
  await seedEmployee(page, name);
  await openEmployee(page, name);

  // Always-on new docs show; student-only docs hidden for a non-student.
  await expect(page.getByText('Health Insurance Card')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Address Registration')).toBeVisible();
  await expect(page.getByText('Enrollment Certificate')).toHaveCount(0);
  await expect(page.getByText('Student ID', { exact: true })).toHaveCount(0);

  // Mark as a working student via Residence & work.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByText('Residence & work', { exact: true }).click();
  await page.getByText('Working student (Werkstudent)').click();
  await page.getByRole('button', { name: /^Save$/ }).click();

  // Re-open fresh; the two student docs now appear.
  await openEmployee(page, name);
  await expect(page.getByText('Enrollment Certificate')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Student ID', { exact: true })).toBeVisible();
});

test('a new document type uploads and round-trips with its Odoo tag', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  const empId = await seedEmployee(page, `ZZ PW Doc ${STAMP} DELETE`);

  const b64 = Buffer.from('%PDF-1.4\nAnmeldung test file\n%%EOF').toString('base64');
  const up = await page.request.post('/api/hr/documents', {
    data: { employee_id: empId, doc_type_key: 'meldebescheinigung', filename: 'anmeldung.pdf', data_base64: b64 },
  });
  const body = await up.json();
  expect(up.ok(), `upload failed: ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.success).toBeTruthy();

  const get = await page.request.get(`/api/hr/documents?employee_id=${empId}`);
  const gj = await get.json();
  expect((gj.documents || []).some((d: { doc_type_key: string }) => d.doc_type_key === 'meldebescheinigung')).toBeTruthy();
});
