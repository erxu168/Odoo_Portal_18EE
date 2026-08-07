import { test, expect } from '@playwright/test';

/**
 * A printed location label must FILL its paper.
 *
 * Ethan, 2026-08-04, on a 297x210 sheet: "the parent location Ssam Basement is
 * way too small. The actual location, dry storage, is way too small."
 *
 * FitText measured the largest size that fits, then cleared the inline font size
 * and trusted React to re-apply it. It does — until the ResizeObserver measures
 * again, computes the SAME size, and React skips the render because state did
 * not change. The element was left with no size at all and fell back to the
 * inherited 16px — which is 4.2mm, inside a 116mm box.
 *
 * This is a DOM-MEASUREMENT bug: it cannot be caught by reasoning or by a unit
 * test, only by rendering at the real size and measuring. Hence a browser test.
 *
 * Needs robot credentials (.env.smoke.local); skips cleanly without them.
 */

const BASE = process.env.SMOKE_BASE_URL || 'https://portal.krawings.de';
const EMAIL = process.env.SMOKE_MANAGER_EMAIL;
const PW = process.env.SMOKE_MANAGER_PASSWORD;

/** 16px — the inherited default — is 4.23mm. Anything near it means "unstyled". */
const BROWSER_DEFAULT_MM = 4.3;

test.use({ viewport: { width: 1400, height: 1000 } });

test('the location name fills the sheet instead of falling back to 16px', async ({ page }) => {
  test.skip(!EMAIL || !PW, 'no robot credentials (.env.smoke.local)');
  test.setTimeout(180000);

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in' }).waitFor({ timeout: 40000 });
  await page.fill('input[type="email"]', EMAIL!);
  await page.fill('input[type="password"]', PW!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 40000 });

  // 177 = DRY STORAGE, inside Ssam Basement — the label he reported.
  await page.goto(`${BASE}/inventory/location/177`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Print this label/i }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /Print this label/i }).click();
  await page.getByRole('button', { name: /^A4 wide$/ }).click();
  await page.waitForTimeout(3000);

  const m = await page.evaluate(() => {
    const px2mm = (px: number) => px / (96 / 25.4);
    const label = document.querySelector('.kw-label') as HTMLElement | null;
    if (!label) return null;
    const all = Array.from(label.querySelectorAll('div')) as HTMLElement[];
    // The NAME's ink div: one leaf div per word, never a broken word. Matched by
    // its first word rather than by shape — the branch's fit box has the same
    // shape and reports its own inherited 16px, which silently passes for a
    // failure.
    const ink = all.find((d) => (d.children[0] as HTMLElement)?.textContent === 'DRY'
      && d.children.length === 2);
    const lr = label.getBoundingClientRect();
    return {
      labelW: px2mm(label.clientWidth),
      labelH: px2mm(label.clientHeight),
      nameMm: ink ? px2mm(parseFloat(getComputedStyle(ink).fontSize)) : 0,
      words: ink ? Array.from(ink.children).map((c) => c.textContent) : [],
      boxH: ink?.parentElement ? px2mm((ink.parentElement as HTMLElement).clientHeight) : 0,
      // Nothing may hang off the label — that is how "DRY STORAG" got printed.
      spills: all.some((d) => {
        const r = d.getBoundingClientRect();
        return r.right > lr.right + 1 || r.bottom > lr.bottom + 1;
      }),
    };
  });

  expect(m, 'the label must render').toBeTruthy();
  expect(Math.round(m!.labelW)).toBe(297);
  expect(Math.round(m!.labelH)).toBe(210);

  expect(m!.nameMm, 'the name fell back to the browser default — FitText lost its size')
    .toBeGreaterThan(BROWSER_DEFAULT_MM * 2);
  expect(m!.nameMm, 'and it should genuinely fill the box, not merely exceed the default')
    .toBeGreaterThan(m!.boxH * 0.4);

  expect(m!.words, 'whole words only — never DRY STORAG / E').toEqual(['DRY', 'STORAGE']);
  expect(m!.spills, 'nothing may hang off the edge of the paper').toBe(false);
});
