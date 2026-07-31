import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Par levels speak the unit staff COUNT in.
 *
 * The canned kidney beans are stored in kg (recipes cook in kg) but counted in
 * cans of 0.28 kg drained weight. Typing par as kilograms asked the manager to
 * do the maths the software exists to do — par is typed and shown in CANS, and
 * the stored row stays in kg so the ordering maths never changes.
 *
 * Runs against staging on the real product (variant 1725, "Bohnen Kidney rot
 * TRS DS 400g", set up as kg + can 0.28 + box 1.68). Restores the par it found.
 */

const BASE = process.env.PORTAL_URL || 'https://portal.krawings.de';
const WAJ = 6;
const BEANS = 1725;        // product.product id — kg base, 1 can = 0.28 kg
const CAN = 0.28;

test.use({ baseURL: BASE });
test.setTimeout(120_000);

async function api(rq: APIRequestContext, path: string, method = 'GET', body?: unknown) {
  const r = await rq.fetch(`${BASE}${path}`, {
    method, data: body as any, headers: { 'Content-Type': 'application/json' },
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* empty body */ }
  return { status: r.status(), body: json };
}

test('par is typed in cans, stored in kg, and shown in cans again', async ({ page, playwright }) => {
  const rq = await playwright.request.newContext();
  const login = await api(rq, '/api/auth/login', 'POST', { email: 'biz@krawings.de', password: 'test1234' });
  expect(login.status, 'login').toBe(200);

  // Remember the par that is really there, to put it back afterwards.
  const before = await api(rq, `/api/inventory/product-par?company_id=${WAJ}&ids=${BEANS}`);
  const prior = (before.body?.par || [])[0] || null;

  try {
    // The browser shares the robot's session — pinned to WAJ, because login
    // sets no active company and the page would otherwise edit whichever
    // company happens to be first for this account.
    await page.context().addCookies([
      ...(await rq.storageState()).cookies,
      { name: 'kw_company_id', value: String(WAJ), domain: new URL(BASE).hostname, path: '/' },
    ]);
    await page.goto(`/products/${BEANS}`);

    // The pack sentence must be in force — without it par stays in kg and
    // this whole test is meaningless.
    await expect(page.getByText(/1 can/i).first()).toBeVisible({ timeout: 20_000 });

    // Type par as CANS: at least 12, at most 24.
    const min = page.getByLabel('Least you want to hold');
    const max = page.getByLabel('Most you want to hold');
    await min.fill('12');
    await max.fill('24');
    await max.blur();
    await expect(page.getByText('Par level saved')).toBeVisible({ timeout: 10_000 });

    // The grey line translates: cans -> kg (and boxes when the chain knows one).
    await expect(page.getByText(/12 cans ≈ 3\.36 kg/)).toBeVisible();
    await expect(page.getByText(/24 cans ≈ 6\.72 kg/)).toBeVisible();

    // Stored row is BASE units — the ordering maths' contract.
    const stored = await api(rq, `/api/inventory/product-par?company_id=${WAJ}&ids=${BEANS}`);
    const row = (stored.body?.par || [])[0];
    expect(row?.par_min).toBeCloseTo(12 * CAN, 6);   // 3.36 kg
    expect(row?.par_max).toBeCloseTo(24 * CAN, 6);   // 6.72 kg

    // Reload: the fields read back as the cans that were typed.
    await page.reload();
    await expect(min).toHaveValue('12', { timeout: 20_000 });
    await expect(max).toHaveValue('24');

    // An untouched blur must not rewrite the row (legacy-par drift guard).
    await min.focus();
    await min.blur();
    await page.waitForTimeout(1500);
    const again = await api(rq, `/api/inventory/product-par?company_id=${WAJ}&ids=${BEANS}`);
    expect((again.body?.par || [])[0]?.par_min).toBeCloseTo(12 * CAN, 6);
  } finally {
    await api(rq, '/api/inventory/product-par', 'PUT', {
      product_id: BEANS, company_id: WAJ,
      par_min: prior?.par_min ?? null, par_max: prior?.par_max ?? null,
    });
  }
});
