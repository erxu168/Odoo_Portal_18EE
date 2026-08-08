import { test, expect } from '@playwright/test';

/**
 * YIELD & TRUE COST, on the real product page.
 *
 * The unit tests prove the arithmetic and the write guards. This proves the
 * section actually RENDERS and saves — the failure mode a unit test cannot see,
 * and the one that has bitten this codebase before: the duplicate-products
 * sheet was designed, approved, built, unit-tested and shipped INVISIBLE,
 * because a form returned early and nobody looked at the real screen.
 *
 * ETHAN'S DATA IS NOT A FIXTURE. This runs against his real staging records, so:
 *  - it records ONE test and removes exactly the row it created, found by ID
 *    from the API — never "the first row in the list", which on a product that
 *    already has measurements would delete somebody else's;
 *  - it asserts the LOCAL preview percentage (a pure function of what was just
 *    typed), never the pooled headline, which legitimately includes other
 *    people's tests and would make this flaky;
 *  - it never taps "use the measured size". That would change a real product's
 *    pack size and therefore every future count of it; the transaction and its
 *    compare-and-swap are covered in yield.unit.spec.ts.
 *
 * Needs robot credentials (.env.smoke.local); skips cleanly without them.
 */

const BASE = process.env.SMOKE_BASE_URL || 'https://portal.krawings.de';
const EMAIL = process.env.SMOKE_MANAGER_EMAIL;
const PW = process.env.SMOKE_MANAGER_PASSWORD;

// VARIANT ids (product.product), not template ids. /products/[id] resolves a
// variant, and a template id lands on "Product not found" — Plantains is
// template 1692 but variant 1698, which is exactly how this test first failed.
const PLANTAIN = 1698;       // "Plantains Yellow Color" — kg, the product he described
const FRIED_PLANTAIN = 1633; // "Fried Plantain" — Units, so a yield test cannot apply

// Deliberately odd, so the row this test created is unmistakable among real ones.
const RAW = '4.137';
const PIECES = '13';
const USABLE = '2.611';
const EXPECTED_PCT = '63.11';   // 2.611 / 4.137

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in' }).waitFor({ timeout: 40000 });
  await page.fill('input[type="email"]', EMAIL!);
  await page.fill('input[type="password"]', PW!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 40000 });
}

interface Row { id: number; raw_qty: number; pieces: number | null; usable_qty: number }

/** The tests currently on record, straight from the API the screen reads. */
async function listTests(page: import('@playwright/test').Page, productId: number): Promise<Row[]> {
  const res = await page.request.get(`${BASE}/api/inventory/yield/${productId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).tests as Row[];
}

test.use({ viewport: { width: 393, height: 852 } });   // a phone, where staff use it

test('a kg product can be weighed in and out, and the numbers add up', async ({ page }) => {
  test.skip(!EMAIL || !PW, 'no robot credentials (.env.smoke.local)');
  test.setTimeout(180000);
  await login(page);

  const before = await listTests(page, PLANTAIN);
  const beforeIds = new Set(before.map((t) => t.id));
  let createdId: number | null = null;

  try {
    await page.goto(`${BASE}/products/${PLANTAIN}`, { waitUntil: 'domcontentloaded' });

    // The section exists at all. (Case-insensitive: labels are uppercased in
    // CSS, and asserting on the styled text has already fooled me once.)
    await page.getByText(/Yield & true cost/i).first().waitFor({ timeout: 60000 });

    const record = page.getByRole('button', { name: /Record a yield test/i });
    await record.waitFor({ timeout: 30000 });
    await record.click();

    // Three fields, in the order a person works: weigh, count, prep, weigh.
    await page.getByLabel('Raw weight').fill(RAW);
    // EXACT, not /How many/: the pack-size field above is "How many kg in one
    // piece", and a loose match hits both.
    await page.getByLabel('How many pieces', { exact: true }).fill(PIECES);
    await page.getByLabel('Usable weight').fill(USABLE);

    // The live preview does the sum before anything is saved. This one is a pure
    // function of the three numbers above, so it is safe to assert exactly.
    await expect(page.getByText(new RegExp(`${EXPECTED_PCT}%\\s*usable`, 'i')))
      .toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /Save this test/i }).click();
    await expect(page.getByRole('button', { name: /Record a yield test/i }))
      .toBeVisible({ timeout: 30000 });   // the form closed, so the save landed

    // CAPTURE THE ID BEFORE ASSERTING ANYTHING. Working it out afterwards by
    // diffing two list snapshots means a failed assertion leaves `createdId`
    // null and the finally block with nothing to delete — the cleanup fails
    // exactly when the test does. (Codex, 2026-08-08.)
    const after = await listTests(page, PLANTAIN);
    const mine = after.filter((t) => !beforeIds.has(t.id));
    createdId = mine.length ? mine[0].id : null;

    expect(mine).toHaveLength(1);
    expect(mine[0].raw_qty).toBeCloseTo(Number(RAW), 6);
    expect(mine[0].pieces).toBe(Number(PIECES));
    expect(mine[0].usable_qty).toBeCloseTo(Number(USABLE), 6);

    // And the screen shows a piece weight worked out from it.
    await expect(page.getByText(/One .*, raw/i).first()).toBeVisible({ timeout: 20000 });
  } finally {
    // ALWAYS clean up, including after a failed assertion — a half-finished run
    // must not leave a measurement on his product that quietly skews an average.
    if (createdId != null) {
      const del = await page.request.delete(
        `${BASE}/api/inventory/yield/${PLANTAIN}?test_id=${createdId}`,
      );
      expect(del.ok()).toBeTruthy();
      const left = await listTests(page, PLANTAIN);
      expect(left.map((t) => t.id)).not.toContain(createdId);
      expect(left).toHaveLength(before.length);
    }
  }
});

test('a product counted in Units says why it cannot be weighed, instead of hiding', async ({ page }) => {
  test.skip(!EMAIL || !PW, 'no robot credentials (.env.smoke.local)');
  test.setTimeout(120000);
  await login(page);

  await page.goto(`${BASE}/products/${FRIED_PLANTAIN}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/Yield & true cost/i).first().waitFor({ timeout: 60000 });

  await expect(page.getByText(/counted in Units, not by weight/i)).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: /Record a yield test/i })).toHaveCount(0);
});
