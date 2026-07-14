import { test, expect } from '@playwright/test';

/**
 * UI coverage for two employee-card fixes:
 *  1. The company/department filter survives returning from a person's card
 *     (repro: filter to a restaurant, open someone, "Mark as left", come back).
 *  2. Uploaded documents on an employee card open in a viewer.
 *
 * Test 1 seeds + deletes a throwaway employee. Test 2 only VIEWS a real
 * employee's document (read-only).
 */
const STAMP = process.env.SMOKE_STAMP || String(Date.now());

test('company filter persists after Mark as left', async ({ page }) => {
  page.on('dialog', (d) => d.accept()); // the "Mark as left" confirm()

  const deps = (await (await page.request.get('/api/hr/departments')).json()).departments || [];
  const dep = deps.find((d: { company_id: number | null }) => d.company_id) || deps[0];
  const companyId = dep.company_id as number;
  const NAME = `ZZ PW Filter ${STAMP} DELETE`;
  const cr = await page.request.post('/api/hr/employees', { data: { name: NAME, company_id: companyId, department_id: dep.id } });
  expect(cr.ok()).toBeTruthy();

  await page.goto('/hr');
  await page.getByText('View all staff').click();

  const companySelect = page.locator('select').first();
  await expect(companySelect).toBeVisible({ timeout: 20_000 });
  await companySelect.selectOption(String(companyId));

  await page.getByPlaceholder('Search employees...').fill(NAME);
  await page.getByText(NAME).first().click();

  await page.getByRole('button', { name: /mark as left/i }).click();

  // Back on the list — the restaurant filter is still applied (not reset to "All").
  await expect(page.locator('select').first()).toHaveValue(String(companyId), { timeout: 20_000 });
});

test('open an uploaded document from an employee card', async ({ page }) => {
  // Find a real employee that has at least one document.
  const emps = (await (await page.request.get('/api/hr/employees')).json()).employees || [];
  let targetName: string | null = null;
  for (const e of emps.slice(0, 50)) {
    const docs = (await (await page.request.get('/api/hr/documents?employee_id=' + e.id)).json()).documents || [];
    if (docs.length > 0) { targetName = e.name; break; }
  }
  expect(targetName, 'need an employee with at least one uploaded document').toBeTruthy();

  await page.goto('/hr');
  await page.getByText('View all staff').click();
  await page.getByPlaceholder('Search employees...').fill(targetName!);
  // Exact-match the card's name — several names are substrings of each other here
  // (e.g. "Ruo Xu" is inside "Ethan-Ruo Xu TEST ACCT" and the company name).
  await page.getByText(targetName!, { exact: true }).first().click();

  const docRow = page.getByText(/Uploaded · Tap to view/i).first();
  await expect(docRow).toBeVisible({ timeout: 20_000 });

  const respPromise = page.waitForResponse((r) => /\/api\/hr\/documents\/\d+$/.test(r.url()) && r.request().method() === 'GET');
  await docRow.click();
  const resp = await respPromise;
  expect(resp.status()).toBe(200);

  // The viewer mounted (DocumentViewer locks body scroll for both PDF and image).
  await expect.poll(async () => await page.evaluate(() => document.body.style.overflow), { timeout: 15_000 }).toBe('hidden');
});
