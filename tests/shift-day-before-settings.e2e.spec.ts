import { test, expect } from '@playwright/test';

/**
 * Day-before reminder — settings UI e2e on staging. Verifies the new standalone
 * "Shift reminder (day before)" toggle renders, reveals the send-time when on,
 * and persists. Leaves the setting OFF (the feature ships off per company).
 *   SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD (admin — sees What a Jerk / co6)
 */
const ADMIN = {
  email: process.env.SMOKE_ADMIN_EMAIL || 'biz@krawings.de',
  password: process.env.SMOKE_ADMIN_PASSWORD || 'test1234',
};
const COMPANY = 6;

test('day-before reminder toggle reveals the send time and persists', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(ADMIN.email);
  await page.getByPlaceholder('Enter your password').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  await context.addCookies([
    { name: 'kw_company_id', value: String(COMPANY), domain: new URL(page.url()).hostname, path: '/' },
  ]);

  // Start from a known OFF state.
  await page.request.put(`/api/shifts/settings?company_id=${COMPANY}`, {
    data: { company_id: COMPANY, dayBeforeReminderEnabled: false },
  });

  await page.goto('/shifts');
  await page.getByRole('button', { name: /Shift settings/i }).click();
  await expect(page.getByText('Shift reminder (day before)')).toBeVisible({ timeout: 20_000 });

  const row = page
    .locator('div.flex.items-center.gap-3')
    .filter({ hasText: 'Email a shift reminder the day before' });
  // Off → no send-time row yet.
  await expect(page.getByText('Send at', { exact: true })).toHaveCount(0);

  // Toggle ON → the send-time row appears and it saves.
  await row.getByRole('switch').click();
  await expect(page.getByText('Send at', { exact: true })).toBeVisible({ timeout: 10_000 });
  const on = await page.request.get(`/api/shifts/settings?company_id=${COMPANY}`);
  expect((await on.json()).dayBeforeReminderEnabled).toBe(true);

  // Toggle OFF again → hidden + persisted off (leave the feature off).
  await row.getByRole('switch').click();
  await expect(page.getByText('Send at', { exact: true })).toHaveCount(0);
  const off = await page.request.get(`/api/shifts/settings?company_id=${COMPANY}`);
  expect((await off.json()).dayBeforeReminderEnabled).toBe(false);
});
