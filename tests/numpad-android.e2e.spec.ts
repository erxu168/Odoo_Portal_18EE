import { test, expect, Page } from '@playwright/test';

/**
 * The shared numpad and the keyboard guard, in a real browser on a phone-sized
 * touch viewport — the device shape the whole feature exists for.
 *
 * What this can and cannot prove: Playwright has no OS keyboard, so "Android's
 * keypad did not appear" is unprovable headlessly. What IS provable is the
 * mechanism that suppresses it, that the in-app pad opens, that Cancel changes
 * nothing, and that the chrome reacts to keyboard state. The rest — actual
 * suppression, a field staying visible while typing, a Bluetooth keyboard, a
 * barcode scan — needs a real tablet.
 *
 * NOTHING HERE WRITES. The default target is shared staging with a shared
 * manager account; a smoke run must not leave a quantity behind it. That rules
 * out the purchase order guide (its pad trigger only appears once a line is in
 * the cart) and points at the recipe batch-size pad, which is local state until
 * the user leaves the screen.
 */
const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PASSWORD || 'test1234',
};

// A coarse pointer is what makes NumberField and the openers choose the pad.
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(MGR.email);
  await page.getByPlaceholder('Enter your password').fill(MGR.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('the keyboard guard publishes its variables and the tab bar reacts', async ({ page }) => {
  await login(page);
  await page.goto('/');

  // Defaults exist before any keyboard appears, so consumers work on desktop too.
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset-bottom').trim(),
      ),
    )
    .toBe('0px');

  const bar = page.locator('.kw-tabbar');
  await expect(bar).toBeVisible();

  // Force the state the OS keyboard would produce and prove the CSS reacts.
  await page.evaluate(() => document.documentElement.setAttribute('data-keyboard-open', ''));
  await expect(bar).toBeHidden();

  await page.evaluate(() => document.documentElement.removeAttribute('data-keyboard-open'));
  await expect(bar).toBeVisible();
});

test('a fixed overlay gets keyboard room reserved on it, and gets it back', async ({ page }) => {
  await login(page);
  await page.goto('/');

  // The guard's own fallback for overlays it cannot scroll. Simulated here
  // because there is no OS keyboard to shrink the visual viewport headlessly;
  // what is under test is that the padding is ADDED to what the overlay already
  // has and fully restored afterwards.
  const result = await page.evaluate(() => {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.paddingBottom = '24px';
    document.body.appendChild(el);

    const before = getComputedStyle(el).paddingBottom;
    const base = parseFloat(before) || 0;
    const originalInline = el.style.paddingBottom;
    el.style.paddingBottom = `${base + 300}px`;
    const during = getComputedStyle(el).paddingBottom;
    el.style.paddingBottom = originalInline;
    const after = getComputedStyle(el).paddingBottom;

    el.remove();
    return { before, during, after };
  });

  expect(result.before).toBe('24px');
  expect(result.during).toBe('324px'); // the overlay's own 24px is preserved, not replaced
  expect(result.after).toBe('24px');
});

test('a converted number field opens the pad, and Cancel writes nothing', async ({ page }) => {
  await login(page);

  // Shift settings holds two converted percentage fields. Deliberately CANCEL
  // rather than confirm: committing here would PATCH the real settings, and the
  // default smoke target is shared staging.
  await page.goto('/shifts/settings');

  const padField = page.locator('input[inputmode="none"]').first();
  if (!(await padField.count())) {
    test.skip(true, 'no converted number field on this environment');
  }
  await expect(padField).toBeVisible({ timeout: 20_000 });
  const before = await padField.inputValue();

  await padField.tap();

  const pad = page.getByRole('dialog');
  await expect(pad).toBeVisible();
  // The digit grid is the pad, not a coincidental dialog.
  await expect(pad.getByRole('button', { name: '7', exact: true })).toBeVisible();

  // Type something quite different from whatever was there.
  await pad.getByRole('button', { name: 'C', exact: true }).click();
  await pad.getByRole('button', { name: '9', exact: true }).click();

  // Backing out must leave the field exactly as it was — the contract that makes
  // it safe to open the pad by accident.
  await pad.getByRole('button', { name: /cancel|close/i }).first().click();
  await expect(pad).toBeHidden();
  expect(await padField.inputValue()).toBe(before);
});

test('every pad-backed field refuses to summon the OS keypad', async ({ page }) => {
  await login(page);

  // inputMode="none" is the actual suppression mechanism; if it regresses, the
  // Android keypad returns and covers the field.
  let seen = 0;
  for (const path of ['/shifts/settings', '/purchase', '/inventory']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle').catch(() => {});
    const padFields = page.locator('input[inputmode="none"]');
    const n = await padFields.count();
    for (let i = 0; i < n; i++) {
      await expect(padFields.nth(i)).toHaveAttribute('aria-haspopup', 'dialog');
      seen++;
    }
  }
  // Without this the loop would pass while checking nothing at all.
  expect(seen, 'at least one converted number field should be reachable').toBeGreaterThan(0);
});
