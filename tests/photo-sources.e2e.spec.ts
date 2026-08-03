import { test, expect, Page } from '@playwright/test';

/**
 * A photo-required count must OFFER THE CAMERA.
 *
 * The strip used a bare <input accept="image/*">, which on the kitchen Android
 * tablets opens the gallery only — staff could not take the photo the count
 * demanded. The [+] now opens an explicit chooser; this test asserts all three
 * sources are visible, on a phone-sized viewport.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};
const SEARCH = 'Signature';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(MGR.email);
  await page.getByPlaceholder('Enter your password').fill(MGR.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('a photo-required count offers Camera, Photos AND Files', async ({ page }) => {
  await login(page);

  // Arrange: this product demands a photo when counted.
  const res = await page.request.get('/api/inventory/products?company_id=6&relevant=1');
  const prod = ((await res.json()).products || []).find((p: any) => String(p.name).includes(SEARCH));
  expect(prod, 'a WAJ product to flag').toBeTruthy();
  const put = await page.request.put(`/api/inventory/product-flags/${prod.id}`, {
    data: { requires_photo: true, units_per_crate: null },
  });
  expect(put.ok()).toBe(true);

  await page.goto('/inventory');
  await page.locator('button', { hasText: 'Quick Count' }).first().click();
  await page.getByPlaceholder('Type product name...').fill(SEARCH);

  // A count above zero makes the photo strip appear on the flagged line.
  await page.locator('button[aria-label="Increase"], button', { hasText: /^\+$/ }).first().click();
  const addPhoto = page.getByRole('button', { name: /Add photo/i }).first();
  await expect(addPhoto).toBeVisible({ timeout: 15_000 });

  // The point of the fix: tapping [+] shows all three sources, not a gallery.
  await addPhoto.click();
  await expect(page.getByText('Add a photo')).toBeVisible({ timeout: 10_000 });
  // exact: the screen also has a "Camera scan" barcode button behind the sheet.
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Photos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Files', exact: true })).toBeVisible();
});
