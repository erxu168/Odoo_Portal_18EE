import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const ADMIN = {
  email: process.env.SMOKE_ADMIN_EMAIL || 'biz@krawings.de',
  password: process.env.SMOKE_ADMIN_PASSWORD || 'test1234',
};
const COMPANY = 6;

// The user's MacBook — a desktop viewport, where clicking a bare type="date"
// input does NOT open the native calendar (only the calendar icon / showPicker does).
test.use({ viewport: { width: 1280, height: 800 } });

async function login(page: Page, context: BrowserContext) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(ADMIN.email);
  await page.getByPlaceholder('Enter your password').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  await context.addCookies([
    { name: 'kw_company_id', value: String(COMPANY), domain: new URL(page.url()).hostname, path: '/' },
  ]);
}

test('desktop: clicking the week-jump date field opens the picker', async ({ page, context }) => {
  // Spy on showPicker so we can assert a click actually asks the browser to open it.
  await page.addInitScript(() => {
    (window as unknown as { __picks: number }).__picks = 0;
    const proto = HTMLInputElement.prototype as unknown as { showPicker?: () => void };
    const orig = proto.showPicker;
    proto.showPicker = function (this: HTMLInputElement) {
      (window as unknown as { __picks: number }).__picks++;
      try {
        return orig?.apply(this);
      } catch {
        /* headless can't actually render the native picker — the call is what matters */
      }
    };
  });
  await login(page, context);
  await page.goto('/shifts');
  await page.getByText('Manage Shifts', { exact: true }).click();

  const jump = page.getByLabel('Jump to a date');
  await expect(jump).toBeAttached({ timeout: 20_000 });
  await jump.click();

  const picks = await page.evaluate(() => (window as unknown as { __picks: number }).__picks);
  expect(picks).toBeGreaterThan(0);
});

test('desktop: clicking the Quick-add Date field opens the picker', async ({ page, context }) => {
  await page.addInitScript(() => {
    (window as unknown as { __picks: number }).__picks = 0;
    const proto = HTMLInputElement.prototype as unknown as { showPicker?: () => void };
    const orig = proto.showPicker;
    proto.showPicker = function (this: HTMLInputElement) {
      (window as unknown as { __picks: number }).__picks++;
      try {
        return orig?.apply(this);
      } catch {
        /* headless */
      }
    };
  });
  await login(page, context);
  await page.goto('/shifts');
  await page.getByText('Manage Shifts', { exact: true }).click();
  await page.getByRole('button', { name: /New shift/i }).first().click();
  await page.getByText('Add shift', { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByLabel('Date', { exact: true }).click();
  const picks = await page.evaluate(() => (window as unknown as { __picks: number }).__picks);
  expect(picks).toBeGreaterThan(0);
});

test('week-jump wiring still changes the week when a date is chosen', async ({ page, context }) => {
  await login(page, context);
  await page.goto('/shifts');
  await page.getByText('Manage Shifts', { exact: true }).click();
  const before = await page.getByText(/Week \d+/).first().textContent();
  await page.getByLabel('Jump to a date').fill('2026-09-14');
  await expect(page.getByText(/Week \d+/).first()).not.toHaveText(before ?? '', { timeout: 10_000 });
});
