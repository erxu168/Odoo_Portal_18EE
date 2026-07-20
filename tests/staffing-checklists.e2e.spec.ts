import { test, expect } from '@playwright/test';

/**
 * Staff Lifecycle Checklists e2e on staging (What a Jerk / co6).
 *
 * Drives the real screens: admin creates a Joining base list + a task in
 * Checklist Setup, then starts a joining checklist for a real employee from
 * their page (confirm prompt with live preview), ticks the task in the
 * two-section view, and sees progress + journey update. API cleanup before
 * and after so the test is repeatable and leaves no trace.
 *   SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD (admin — sees What a Jerk / co6)
 */
const ADMIN = {
  email: process.env.SMOKE_ADMIN_EMAIL || 'biz@krawings.de',
  password: process.env.SMOKE_ADMIN_PASSWORD || 'test1234',
};
const COMPANY = 6;
const MARK = 'E2E-STAFFING'; // stamped into names so cleanup can find our rows

test.describe.configure({ mode: 'serial' });

async function login(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(ADMIN.email);
  await page.getByPlaceholder('Enter your password').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  await context.addCookies([
    { name: 'kw_company_id', value: String(COMPANY), domain: new URL(page.url()).hostname, path: '/' },
  ]);
}

/** Delete every template whose name carries our marker (idempotent). */
async function cleanTemplates(page: import('@playwright/test').Page) {
  const r = await page.request.get(`/api/staffing/templates?company_id=${COMPANY}`);
  if (!r.ok()) return;
  for (const t of (await r.json()).templates ?? []) {
    if (String(t.name ?? '').includes(MARK)) {
      await page.request.delete(`/api/staffing/templates/${t.id}`).catch(() => {});
    }
  }
}

test('admin builds a joining checklist, starts it for an employee, ticks a task', async ({ page, context }) => {
  test.setTimeout(180_000);
  await login(page, context);
  await cleanTemplates(page);

  // ── 1. Checklist Setup: the admin tile exists and opens the setup screen.
  // NB: tiles sit inside dnd-kit sortable wrappers (div[role=button]) — target
  // the real <button> element to avoid strict-mode double matches.
  await page.goto('/hr');
  const setupTile = page.locator('button').filter({ hasText: 'Checklist Setup' }).first();
  await expect(setupTile).toBeVisible({ timeout: 20_000 });
  await setupTile.click();
  await expect(page.getByText('Joining', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── 2. Create the shared base list via the New checklist modal.
  await page.getByRole('button', { name: /New checklist/i }).click();
  await expect(page.getByRole('heading', { name: 'New checklist' })).toBeVisible();
  // Defaults: stage=Joining, type=Shared base. Give it a marked name.
  await page.getByPlaceholder('Auto-named if left blank').fill(`${MARK} base`);
  await page.getByRole('button', { name: /^Create$/ }).click();

  // Landed in the editor for the new (empty) checklist.
  await expect(page.getByText('No tasks yet.').first()).toBeVisible({ timeout: 15_000 });

  // ── 3. Add one business task with a deadline.
  await page.getByRole('button', { name: /Add task/i }).click();
  await page.getByPlaceholder('e.g. Set up POS PIN').fill(`${MARK} Set up POS PIN`);
  // Business + employee's manager are the defaults; enable the deadline toggle.
  await page.getByRole('button', { name: 'Deadline', exact: true }).click();
  await expect(page.locator('input[type="number"]')).toBeVisible();
  await page.locator('input[type="number"]').fill('3');
  await page.getByRole('button', { name: /Save task/i }).click();
  await expect(page.getByText(`${MARK} Set up POS PIN`)).toBeVisible({ timeout: 15_000 });

  // ── 4. Add one employee task (self-service).
  await page.getByRole('button', { name: /Add task/i }).click();
  await page.getByPlaceholder('e.g. Set up POS PIN').fill(`${MARK} Sign contract`);
  await page.getByRole('button', { name: 'Employee', exact: true }).click();
  await page.locator('select').first().selectOption('the_employee');
  await page.getByRole('button', { name: /Save task/i }).click();
  await expect(page.getByText(`${MARK} Sign contract`)).toBeVisible({ timeout: 15_000 });

  // ── 5. Verify (via the deployed API) the base now carries both tasks.
  // (/hr is an in-page state machine — browser back would reset to the dashboard.)
  const tpls = await page.request.get(`/api/staffing/templates?company_id=${COMPANY}`);
  expect(tpls.ok()).toBeTruthy();
  const ourBase = ((await tpls.json()).templates ?? []).find(
    (t: { name?: string }) => String(t.name ?? '').includes(MARK),
  );
  expect(ourBase?.task_count).toBe(2);
  expect(ourBase?.business_count).toBe(1);
  expect(ourBase?.employee_count).toBe(1);

  // ── 6. Find an employee (via API for determinism), then start their joining
  // checklist from their page via the confirm prompt.
  const emps = await page.request.get(`/api/hr/employees?filter=all`);
  expect(emps.ok()).toBeTruthy();
  const list = (await emps.json()).employees ?? [];
  const emp = list.find((e: { company_id?: [number, string] }) => Array.isArray(e.company_id) && e.company_id[0] === COMPANY) || list[0];
  expect(emp, 'no employee available on staging to start a checklist for').toBeTruthy();

  // Cancel any open joining checklist for this employee (repeatability).
  const inst0 = await page.request.get(`/api/staffing/checklists?employee_id=${emp.id}`);
  if (inst0.ok()) {
    for (const i of (await inst0.json()).instances ?? []) {
      if (i.status === 'open' && i.stage === 'joining') {
        await page.request.post(`/api/staffing/checklists/${i.id}/cancel`).catch(() => {});
      }
    }
  }

  // The employee page shows the Lifecycle checklists card with a Start action.
  await page.goto('/hr');
  await page.locator('button').filter({ hasText: 'Employees' }).first().click();
  await page.getByPlaceholder(/search/i).fill(String(emp.name).slice(0, 12));
  await page.locator('button').filter({ hasText: String(emp.name) }).first().click();
  await expect(page.getByText('Lifecycle checklists')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /\+ Start/ }).click();

  // The confirm prompt shows the live preview and starts the checklist.
  await expect(page.getByText(/joining checklist\?/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/creates .*2 tasks/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Start checklist/i }).click();

  // ── 7. The two-section checklist view opens; tick the business task.
  await expect(page.getByText('Business tasks', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Employee tasks', { exact: false })).toBeVisible();
  await expect(page.getByText('0 of 2 done')).toBeVisible();
  await page.getByText(`${MARK} Set up POS PIN`).click();
  await expect(page.getByText('1 of 2 done')).toBeVisible({ timeout: 15_000 });

  // ── 8. Back on the employee page (re-navigate — /hr is an in-page state
  // machine, browser-back would reset it), the journey card shows progress 1/2.
  await page.goto('/hr');
  await page.locator('button').filter({ hasText: 'Employees' }).first().click();
  await page.getByPlaceholder(/search/i).fill(String(emp.name).slice(0, 12));
  await page.locator('button').filter({ hasText: String(emp.name) }).first().click();
  await expect(page.getByText('Lifecycle checklists')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('1/2')).toBeVisible({ timeout: 15_000 });

  // ── Cleanup: cancel the instance and delete the template.
  const inst = await page.request.get(`/api/staffing/checklists?employee_id=${emp.id}`);
  for (const i of (await inst.json()).instances ?? []) {
    if (i.status === 'open') await page.request.post(`/api/staffing/checklists/${i.id}/cancel`).catch(() => {});
  }
  await cleanTemplates(page);
});
