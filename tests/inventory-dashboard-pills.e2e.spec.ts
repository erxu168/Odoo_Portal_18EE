import { test, expect, Page } from '@playwright/test';

/**
 * The inventory dashboard's stat pills are NAVIGATION, not decoration:
 * "To count" and "Counted" open My Counts, "To review" opens Review (managers),
 * and the stale-counts notice takes you to the Review it talks about.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('manager: the To review pill opens Review', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await page.goto('/inventory');
  await page.getByText('To review', { exact: true }).click();
  await expect(page.getByText('Approve or reject submitted counts')).toBeVisible({ timeout: 15_000 });
});

test('manager: the To count pill opens My Counts', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await page.goto('/inventory');
  await page.getByText('To count', { exact: true }).click();
  await expect(page.getByText(/My Counts|Today.s Counts/).first()).toBeVisible({ timeout: 15_000 });
});

test('manager: the stale-counts notice (when shown) opens Review', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await page.goto('/inventory');
  // Wait for the dashboard to settle, then only test the notice if data shows it.
  await page.getByText('To review', { exact: true }).waitFor({ timeout: 15_000 });
  const notice = page.getByText(/started and never submitted/);
  if (!(await notice.isVisible().catch(() => false))) test.skip(true, 'no stale counts on this dataset');
  await notice.click();
  await expect(page.getByText('Approve or reject submitted counts')).toBeVisible({ timeout: 15_000 });
});
