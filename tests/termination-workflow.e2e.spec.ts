import { test, expect } from '@playwright/test';

/**
 * Termination v3 lifecycle — real-browser regression on staging.
 *
 * Walks DEMO Max Mustermann (WAJ) through:
 *   draft → Confirm → Generate PDF → Mark as signed → "Letter sent" dispatch
 *   → IN TRANSIT (the new stage) → Confirm-delivery form renders → Edit-details
 *   sheet saves a tracking number → cancel (cleanup; cancelled records are
 *   hidden from both list buckets, and cancel resets the departure date).
 *
 * The in_transit→delivered→archive leg is deliberately NOT driven here: a
 * delivered record is permanent (no portal delete), so that leg is covered by
 * the Odoo-side state-machine checks instead. Also proves the authz boundary:
 * a manager WITHOUT the termination module gets 403.
 *
 * Run: SMOKE_ENV=staging npx playwright test --project=modules tests/termination-workflow.e2e.spec.ts
 */

const BASE = 'https://portal.krawings.de';
const ADMIN = { email: 'biz@krawings.de', password: 'test1234' };
const PLAIN_MANAGER = { email: 'marco@test.krawings.de', password: 'test1234' }; // no termination module

async function login(page: import('@playwright/test').Page, who: { email: string; password: string }) {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('you@example.com').fill(who.email);
  await page.getByPlaceholder('Enter your password').fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
}

test('authz: manager without the termination module is rejected server-side', async ({ page }) => {
  await login(page, PLAIN_MANAGER);
  const res = await page.request.get(`${BASE}/api/termination`);
  expect(res.status()).toBe(403);
});

test('lifecycle: draft → In Transit via the new dispatch flow (+ edit sheet)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1194, height: 834 });
  await login(page, ADMIN);

  const empRes = await page.request.get(`${BASE}/api/termination/employees?company_id=6`);
  const employees = (await empRes.json()).data ?? [];
  const demo = employees.find((e: { name: string }) => e.name.includes('DEMO Max'));
  expect(demo, 'DEMO Max Mustermann must exist in WAJ').toBeTruthy();

  const createRes = await page.request.post(`${BASE}/api/termination`, {
    data: {
      employee_id: demo.id, company_id: 6, termination_type: 'ordentlich_probezeit',
      calc_method: 'bgb', letter_date: new Date().toISOString().split('T')[0],
      employee_name: demo.name, employee_street: '', employee_city: '', employee_zip: '',
    },
  });
  const created = await createRes.json();
  expect(created.ok).toBeTruthy();
  const rid = created.data.id as number;

  try {
    // Drive the record page through the new flow.
    await page.goto(`${BASE}/termination`);
    await page.getByText('In Progress', { exact: true }).click();
    await page.getByText(demo.name).first().click();
    await expect(page.getByRole('button', { name: 'Confirm termination' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Confirm termination' }).click();
    await expect(page.getByRole('button', { name: /Generate PDF/ })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Generate PDF/ }).click();
    await expect(page.getByRole('button', { name: 'Mark as signed' })).toBeVisible({ timeout: 30_000 });
    const closeBtn = page.getByRole('button', { name: /close/i }).first();
    if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();

    await page.getByRole('button', { name: 'Mark as signed' }).click();
    await expect(page.getByRole('button', { name: /Letter sent/ })).toBeVisible({ timeout: 15_000 });

    // Dispatch → In Transit.
    await page.getByRole('button', { name: /Letter sent/ }).click();
    await page.getByText('Registered mail, mailbox', { exact: false }).first().click();
    await page.getByRole('button', { name: /Save|Record|Submit|Confirm/ }).first().click();
    await expect(page.getByRole('button', { name: 'Confirm delivery' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('In Transit').first()).toBeVisible();

    // Confirm-delivery form renders (not submitted — delivered is permanent).
    await page.getByRole('button', { name: 'Confirm delivery' }).click();
    await expect(page.getByRole('button', { name: /Delivered ✓/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Cancel' }).first().click();

    // Edit sheet saves a tracking number.
    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByPlaceholder('RR 1234 5678 9 DE').fill('RR 5555 6666 7 DE');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('RR 5555 6666 7 DE')).toBeVisible({ timeout: 15_000 });
  } finally {
    // Cleanup: cancel (allowed from in_transit; resets departure; hidden from lists).
    const res = await page.request.post(`${BASE}/api/termination/${rid}/cancel`);
    const ok = (await res.json().catch(() => ({ ok: false }))).ok;
    if (!ok) console.warn(`[e2e] could not cancel termination ${rid} — check manually`);
  }
});
