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
  // The dashboard seeds itself with the STAFF capability floor and upgrades
  // once /api/auth/me answers — the pill becomes tappable at that moment. A
  // person cannot tap faster than that; a robot must wait for a manager-only
  // element (the Review tile) before tapping like one.
  await page.locator('button', { hasText: 'Review' }).first().waitFor({ timeout: 15_000 });
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
  const notice = page.getByText(/from earlier days (is|are) still open/);
  if (!(await notice.isVisible().catch(() => false))) test.skip(true, 'no stuck counts on this dataset');
  await notice.click();
  // It must land on the list that can actually SHOW them — not on Submitted,
  // which was the dead end this fixed.
  await expect(page.getByText('Approve or reject submitted counts')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Not submitted' })).toHaveAttribute('aria-pressed', 'true');
});

test('manager: the Not submitted list shows stuck counts and Back returns to it', async ({ page }) => {
  await login(page, MGR.email, MGR.password);
  await page.goto('/inventory');
  await page.locator('button', { hasText: 'Review' }).first().waitFor({ timeout: 15_000 });
  await page.getByText('To review', { exact: true }).click();

  await page.getByRole('button', { name: 'Not submitted' }).click();
  const open = page.getByRole('button', { name: 'Open and finish it' }).first();
  if (!(await open.isVisible({ timeout: 10_000 }).catch(() => false))) {
    await expect(page.getByText('Nothing stuck')).toBeVisible();
    return;                       // a clean dataset is a valid outcome
  }
  await open.click();
  await page.getByRole('button', { name: /back/i }).first().click();
  // Back must return to the STUCK list, not to Submitted.
  await expect(page.getByRole('button', { name: 'Not submitted' })).toHaveAttribute('aria-pressed', 'true');
});
