import { test, expect } from '@playwright/test';

const BASE = 'https://portal.krawings.de';

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('you@example.com').fill('biz@krawings.de');
  await page.getByPlaceholder('Enter your password').fill('test1234');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
}

test('termination: layout + employee-file links', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 }); // tablet landscape
  await login(page);

  // 1. Dashboard look (ribbon check — screenshot reviewed by a human/model).
  await page.goto(`${BASE}/termination`);
  await expect(page.getByText('New Termination')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: '/tmp/term-after-dash.png' });

  // 2. Wizard: wait for the employee list, then the first card's "Open file".
  await page.getByText('New Termination', { exact: true }).click();
  await expect(page.getByPlaceholder('Search employee...')).toBeVisible({ timeout: 15_000 });
  const openFile = page.getByRole('button', { name: /Open .+ file/ }).first();
  await expect(openFile).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: '/tmp/term-after-wizard.png' });
  const aria = (await openFile.getAttribute('aria-label')) || '';
  const empName = aria.replace(/^Open /, '').replace(/’s file$/, '');

  // 3. Open file → that employee's record renders (deep link).
  await openFile.click();
  await page.waitForURL(/\/hr\?employee=/, { timeout: 15_000 });
  await expect(page.getByText(empName).first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: '/tmp/term-after-empfile.png' });

  // 4. Back returns to the termination module (dashboard — step 1 holds no state).
  await page.goBack();
  await expect(page.getByText('New Termination', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText('New Termination', { exact: true }).click();
  await expect(page.getByPlaceholder('Search employee...')).toBeVisible({ timeout: 15_000 });

  // 5. Tap-to-select still advances to step 2.
  await page.locator('button', { hasText: empName }).first().click();
  await expect(page.getByText(/Standard Termination|Probation Termination/).first()).toBeVisible({ timeout: 15_000 });
});
