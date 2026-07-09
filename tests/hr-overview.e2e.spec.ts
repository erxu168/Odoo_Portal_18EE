import { test, expect, Page } from '@playwright/test';

/**
 * e2e: the manager "Needs attention" overview loads its three sections
 * (missing documents / expiring credentials / contracts ending), company-scoped.
 * Runs against staging (self-login manager).
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

test('manager overview shows the needs-attention sections', async ({ page }) => {
  page.on('response', (r) => { if (r.url().includes('/api/hr/overview')) console.log('[overview]', r.status()); });
  await login(page, MGR.email, MGR.password);

  await page.goto('/hr');
  await page.getByText('Needs attention').first().click();

  // The three sections render (data-driven titles include the day windows).
  await expect(page.getByText('Missing documents')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Expiring within \d+ days/)).toBeVisible();
  await expect(page.getByText(/Contracts ending within \d+ days/)).toBeVisible();

  // No load error banner.
  await expect(page.getByText(/Could not load the overview/i)).toHaveCount(0);
});
