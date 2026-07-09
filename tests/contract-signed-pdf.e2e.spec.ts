import { test, expect, Page } from '@playwright/test';

/**
 * Signed hard-copy contract PDF — e2e against staging, real browser.
 * As a MANAGER (the stricter audience): seed a throwaway employee, create a
 * contract, then upload / view / round-trip / delete the signed PDF. Proves the
 * file is stored on Odoo hr.contract (so the same file shows on the Odoo form).
 *
 * The throwaway employee (named "…DELETE") is left for out-of-band cleanup,
 * matching the other contract specs.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const STAMP = process.env.SMOKE_STAMP || String(Date.now());
const NAME = `ZZ PW SignedPDF ${STAMP} DELETE`;

// A tiny PDF payload. Contents don't matter — the route stores bytes verbatim and
// the viewer only needs a PDF mimetype; we assert the round-trip byte length.
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\n' +
  'trailer<</Root 1 0 R>>\n%%EOF\n',
);

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('manager: upload, view, store and delete a signed contract PDF', async ({ page }) => {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await login(page, MGR.email, MGR.password);

  // --- Seed a throwaway employee in the manager's own company ---
  const depsRes = await page.request.get('/api/hr/departments');
  const deps = (await depsRes.json()).departments || [];
  const dep = deps.find((d: { company_id: number | null }) => d.company_id) || deps[0];
  expect(dep, 'need a department to seed an employee').toBeTruthy();
  const createRes = await page.request.post('/api/hr/employees', {
    data: { name: NAME, company_id: dep.company_id, department_id: dep.id },
  });
  expect(createRes.ok(), 'seed employee').toBeTruthy();
  const empId = (await createRes.json()).employee.id;
  expect(empId).toBeTruthy();

  // --- Open Contract & hours ---
  await page.goto('/hr');
  await page.getByText('View all staff').click();
  const searchBox = page.getByPlaceholder('Search employees...');
  await expect(searchBox).toBeVisible({ timeout: 20_000 });
  await searchBox.fill(NAME);
  await page.getByText(NAME).first().click();
  const contractBtn = page.getByRole('button', { name: /contract .* hours/i });
  await expect(contractBtn).toBeVisible({ timeout: 20_000 });
  await contractBtn.click();

  // No contract yet → the signed-contract card shows the "save first" hint.
  await expect(page.getByText(/save the contract first/i)).toBeVisible({ timeout: 20_000 });

  // --- Create a contract (hours only; manager can't set pay) ---
  await page.getByPlaceholder('e.g. 20').fill('20');
  await page.getByPlaceholder('e.g. 5').fill('4');
  await page.getByRole('button', { name: /create contract/i }).click();

  // Reopen → the upload control is now available.
  await expect(contractBtn).toBeVisible({ timeout: 20_000 });
  await contractBtn.click();
  await expect(page.getByText(/upload signed contract/i)).toBeVisible({ timeout: 20_000 });

  // --- Upload the PDF via the hidden file input ---
  await page.locator('input[type="file"]').setInputFiles({
    name: 'signed-contract.pdf', mimeType: 'application/pdf', buffer: PDF,
  });

  // Widget flips to the "uploaded" state with View / Replace.
  await expect(page.getByText('Uploaded')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^View$/ })).toBeVisible();

  // --- Round-trip: the file is readable back from Odoo, same bytes ---
  const cRes = await page.request.get(`/api/hr/employee/${empId}/contract`);
  const cJson = await cRes.json();
  expect(cJson.contract?.has_signed_pdf, 'contract flagged as having a signed PDF').toBeTruthy();
  const contractId = cJson.contract.id;
  const fileRes = await page.request.get(`/api/hr/employee/${empId}/contract/signed-pdf?contract_id=${contractId}`);
  expect(fileRes.status()).toBe(200);
  expect(fileRes.headers()['content-type']).toContain('application/pdf');
  expect((await fileRes.body()).length).toBe(PDF.length);

  // --- View opens the PDF viewer overlay ---
  await page.getByRole('button', { name: /^View$/ }).click();
  const closeBtn = page.getByRole('button', { name: /close/i });
  await expect(closeBtn).toBeVisible({ timeout: 20_000 });
  await closeBtn.click();

  // --- Delete cleans up and the file is gone (404) ---
  const delRes = await page.request.delete(`/api/hr/employee/${empId}/contract/signed-pdf?contract_id=${contractId}`);
  expect(delRes.ok(), 'delete signed PDF').toBeTruthy();
  const gone = await page.request.get(`/api/hr/employee/${empId}/contract/signed-pdf?contract_id=${contractId}`);
  expect(gone.status()).toBe(404);
});
