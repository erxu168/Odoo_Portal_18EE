import { test, expect, Page } from '@playwright/test';

/**
 * Container-level counting, in a real browser: a manager opts a product into
 * the level diagram, and Quick Count's sheet gains "And the open one?" — tap
 * ¾ on the bucket, the litres math follows.
 *
 * Runs against a seeded local stack (SMOKE_BASE_URL + scratch db) because the
 * staging manager fixture cannot see WAJ; flag writes land in the scratch db.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const SEARCH = 'Signature';   // "Jerk Rice and Peas (Signature)", kg base

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(MGR.email);
  await page.getByPlaceholder('Enter your password').fill(MGR.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

async function targetProductId(page: Page): Promise<number> {
  const res = await page.request.get(`/api/inventory/products?company_id=6&relevant=1`);
  const d = await res.json();
  const p = (d.products || []).find((x: any) => String(x.name).includes(SEARCH));
  expect(p, `a WAJ product matching "${SEARCH}"`).toBeTruthy();
  return p.id;
}

test('manager opts a product in; Quick Count marks ¾ of a bucket as 7.5 kg', async ({ page }) => {
  await login(page);
  const pid = await targetProductId(page);

  // Arrange the counting words + the diagram via the same API the UI calls.
  const put = await page.request.put(`/api/inventory/product-flags/${pid}`, {
    data: { units_per_crate: 10, pack_label: 'bucket', count_mode: 'pack_loose', level_shape: 'round' },
  });
  expect(put.ok()).toBe(true);

  // The product page shows the selector with Round bucket chosen.
  await page.goto(`/products/${pid}`);
  await expect(page.getByText('Level diagram for the open', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Round bucket' })).toHaveAttribute('aria-pressed', 'true');

  // Quick Count: the sheet gains "And the open one?" and the maths follows.
  await page.goto('/inventory');
  await page.locator('button', { hasText: 'Quick Count' }).first().click();
  await page.getByPlaceholder('Type product name...').fill(SEARCH);
  await page.locator('button', { hasText: 'Count' }).first().click();

  await expect(page.getByText('And the open one?')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '¾', exact: true }).click();
  await expect(page.getByText(/¾ of a bucket/)).toBeVisible();
  await expect(page.getByText('7.5', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Save count' }).click();
  // Instant feedback on the list: the row now carries the 7.5 kg total.
  await expect(page.getByText('1 product counted')).toBeVisible({ timeout: 10_000 });
});
