import { test, expect } from '@playwright/test';
import path from 'path';

// Drives the sign-off mock so it is never shown to a stakeholder broken.
const MOCK = 'file://' + path.resolve(__dirname, '../mocks/kds-cooktimer-setup/kds-cooktimer-setup-v1.html');

test('mock renders the real staging data and both tabs work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(MOCK);

  // Real profiles grouped under real stations.
  await expect(page.getByText('French Fries', { exact: true })).toBeVisible();
  await expect(page.getByText('Smokey Boneless Jerk Chicken')).toBeVisible();
  await expect(page.locator('.grp-h .nm').filter({ hasText: 'Deep Fry & Smoker' })).toBeVisible();
  // Fries chain 210+120+150 = 8:00 total.
  await expect(page.locator('.prow').filter({ hasText: 'French Fries' }).locator('.ptot .v')).toHaveText('8:00');
  // Action steps carry no duration.
  await expect(page.locator('.chip.act').filter({ hasText: 'Spray beer' })).toBeVisible();

  // States a manager actually hits are represented.
  await expect(page.locator('.pill').filter({ hasText: 'NO DISH LINKED' })).toBeVisible();
  await expect(page.locator('.pill').filter({ hasText: 'COOKING NOW' })).toBeVisible();

  await page.locator('#tabS').click();
  await expect(page.locator('.srow')).toHaveCount(3);
  // Deleting a station that still holds dishes is never a dead end: it offers to move them.
  await page.locator('.srow').filter({ hasText: 'Deep Fry' }).locator('.trash').click();
  await expect(page.locator('#cfBody')).toContainText('4 dishes');
  await expect(page.locator('#cfMove')).toBeVisible();
  await expect(page.locator('#cfGo')).toHaveText('Move dishes & delete');
  await page.locator('.btn-cancel').click();

  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/mock-profiles.png', fullPage: true });
});

test('editor opens with the step chain and the product picker works', async ({ page }) => {
  await page.goto(MOCK);
  await page.locator('.ptap').filter({ hasText: 'French Fries' }).click();
  await expect(page.locator('#editor')).toHaveClass(/on/);
  await expect(page.locator('#edTitle')).toHaveText('Edit dish');
  await expect(page.locator('#edSteps .step')).toHaveCount(3);
  await expect(page.locator('#edTotal')).toHaveText('8:00');

  // Changing a step time updates the total live (210 -> 4:00 = 240 ⇒ 8:30).
  await page.locator('#edSteps .tin').first().fill('4:00');
  await page.locator('#edSteps .tin').first().dispatchEvent('change');
  await expect(page.locator('#edTotal')).toHaveText('8:30');

  await page.locator('.chg').click();
  await expect(page.locator('#picker')).toHaveClass(/bs on/);
  await page.locator('#pq').fill('wrap');
  await expect(page.locator('.pitem')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/mock-picker.png' });
});

test('delete asks for confirmation and names the dish', async ({ page }) => {
  await page.goto(MOCK);
  await page.locator('.prow').filter({ hasText: 'Fried Plantain' }).locator('.trash').click();
  await expect(page.locator('#confirm')).toHaveClass(/cf on/);
  await expect(page.locator('#cfTitle')).toHaveText('Delete Fried Plantain?');
  await page.screenshot({ path: 'test-results/mock-confirm.png' });
  await page.locator('#cfGo').click();
  // The row is gone (the confirmation toast still names it, so assert on the row).
  await expect(page.locator('.prow').filter({ hasText: 'Fried Plantain' })).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Deleted Fried Plantain');
});
