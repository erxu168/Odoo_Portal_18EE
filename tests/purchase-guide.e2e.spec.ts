import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(EMAIL);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
}

test('order guide: editable settings, order method, create-product sheet', async ({ page, context }) => {
  test.skip(!EMAIL, 'SMOKE_EMAIL/PASSWORD not set');
  page.on('dialog', (d) => d.accept());
  await login(page);
  // Scope to WAJ (company 6) where the test suppliers/guides live.
  await context.addCookies([{ name: 'kw_company_id', value: '6', url: 'https://portal.krawings.de' }]);

  await page.goto('/purchase');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/guide-1-dashboard.png' });

  // Open "Order Templates" (dashboard tile — disambiguated from the header gear).
  await page.getByRole('button', { name: /Build & edit/i }).click();
  await expect(page.getByRole('button', { name: /add supplier/i })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: '/tmp/guide-2-manage.png' });

  // Open the first supplier's guide.
  await page.getByText(/Tap to edit/i).first().click();
  await expect(page.getByText('+ Create new product')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: '/tmp/guide-3-guide.png' });

  // ③ Show-all: product list is populated by default (before typing), with paging.
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: '/tmp/guide-3b-listall.png' });

  // The old save button must be gone (save-as-you-go).
  await expect(page.getByRole('button', { name: /save delivery settings/i })).toHaveCount(0);

  // Expand settings; verify the new editable fields + order method are present.
  await page.getByText('Delivery Settings').click();
  await expect(page.getByText('Order method')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Supplier name')).toBeVisible();
  await page.screenshot({ path: '/tmp/guide-4-settings.png' });

  // Save-as-you-go: click an order-method option and expect the saved status.
  await page.getByRole('button', { name: 'WhatsApp' }).click();
  await expect(page.getByText(/Saved|Saving/i)).toBeVisible({ timeout: 8_000 });
  await page.screenshot({ path: '/tmp/guide-5-saved.png' });
  // Put it back to Email so we do not leave the test supplier on WhatsApp.
  await page.getByRole('button', { name: 'Email' }).first().click();
  await page.waitForTimeout(1200);

  // Open the Create Product sheet (do NOT submit — avoid creating test data).
  await page.getByText('+ Create new product').click();
  await expect(page.getByRole('heading', { name: /New product/i })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: /Create & add to guide/i })).toBeVisible();
  await page.screenshot({ path: '/tmp/guide-6-createsheet.png' });
});
