import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * ONE PRODUCT, ONE COUNT PER DAY — driven against the real staging server.
 *
 * Ethan's Daily and Weekly lists shared 7 products, so staff were asked for the
 * same shelf twice and the day ended with two answers for one product. The rule
 * now decides this when a count freezes its lines: a product another of today's
 * counts already holds is not put on this one.
 *
 * This test makes its own second list beside whatever is really running today,
 * checks the outcome through the API and in the browser on a phone, and removes
 * the list afterwards.
 */

const BASE = process.env.PORTAL_URL || 'https://portal.krawings.de';
const WAJ = 6;

test.use({ baseURL: BASE });
test.setTimeout(180_000);

async function api(rq: APIRequestContext, path: string, method = 'GET', body?: unknown) {
  const r = await rq.fetch(`${BASE}${path}`, {
    method, data: body as any, headers: { 'Content-Type': 'application/json' },
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status(), body: json };
}

test('a second list beside today’s count takes only its own products, and staff walk one list', async ({ playwright, page }) => {
  const rq = await playwright.request.newContext();
  expect((await api(rq, '/api/auth/login', 'POST',
    { email: 'biz@krawings.de', password: 'test1234' })).status, 'login').toBe(200);

  const TODAY = new Date().toISOString().slice(0, 10);
  const linesOf = async (id: number) => {
    const r = await api(rq, `/api/inventory/counts?session_id=${id}`);
    return ((r.body?.items || []) as any[]).map((i) => i.odoo_product_id);
  };

  // Today's real count and what it holds.
  const sessions = await api(rq, `/api/inventory/sessions?date=${TODAY}`);
  const live = (sessions.body?.sessions || []).filter((s: any) => s.status === 'pending' || s.status === 'in_progress');
  expect(live.length, 'a count must be running today for this test to mean anything').toBeGreaterThan(0);
  const held: number[] = [];
  for (const s of live) held.push(...await linesOf(s.id));
  console.log('open counts', live.map((s: any) => s.id), 'hold', held.length, 'lines');
  expect(held.length, 'today’s count holds products').toBeGreaterThan(2);
  expect(held.every((x) => typeof x === 'number'), 'line ids read correctly').toBe(true);

  const model = (await api(rq, `/api/inventory/templates?company_id=${WAJ}`)).body?.templates?.[0];
  expect(model, 'need an existing list to copy restaurant/location from').toBeTruthy();
  const shared = Array.from(new Set(held)).slice(0, 3);
  // Products NOT counted today: take them from the catalog, minus everything held.
  const cat = await api(rq, `/api/inventory/products?company_id=${WAJ}&limit=200`);
  const free = (cat.body?.products || []).map((p: any) => p.id).filter((id: number) => !held.includes(id)).slice(0, 2);
  console.log('free (nobody counting):', free);
  expect(free.length, 'need two products nobody is counting today').toBe(2);

  let listId: number | null = null;
  try {
    // The manager is warned first — this 409 is what raises the "also on Daily
    // Count" sheet in the list editor.
    const warned = await api(rq, '/api/inventory/templates', 'POST', {
      name: 'ZZ verify one-per-day', frequency: 'daily', schedule_days: [],
      location_id: model.location_id, company_id: WAJ, category_ids: [],
      product_ids: [...shared, ...free], assign_type: null, assign_id: null,
    });
    expect(warned.status, 'overlap is reported to the manager before saving').toBe(409);
    expect(warned.body?.error).toBe('DUPLICATE_PRODUCTS');
    const named = new Set((warned.body?.clash || []).map((r: any) => r.product_id));
    expect(named.size, 'and it names the shared products').toBeGreaterThan(0);
    for (const pid of named) {
      expect([...shared, ...free], `clash names a product this list asked for`).toContain(pid);
    }

    const made = await api(rq, '/api/inventory/templates', 'POST', {
      name: 'ZZ verify one-per-day', frequency: 'daily', schedule_days: [],
      location_id: model.location_id, company_id: WAJ, category_ids: [],
      product_ids: [...shared, ...free], assign_type: null, assign_id: null,
      allow_duplicates: true,
    });
    listId = made.body?.id ?? null;   // captured first: cleanup must run even if the next line fails
    console.log('create ->', made.status, JSON.stringify(made.body));
    expect(made.status, 'saving anyway is allowed — the system counts each thing once').toBeLessThan(300);
    expect(listId).toBeTruthy();

    // Creating the list starts today's count for it in the same call.
    expect(made.body?.deferred, 'the new list counts TODAY — it is not sent away').toBeFalsy();
    const newId = made.body?.session_id;
    expect(newId, 'and it has a count of its own').toBeTruthy();

    const got = (await linesOf(newId)).sort((a, b) => a - b);
    expect(got, 'only the products nobody else is counting today').toEqual(free.slice().sort((a: number, b: number) => a - b));

    // THE invariant, read back from the live server.
    const after = await api(rq, `/api/inventory/sessions?date=${TODAY}`);
    const openNow = (after.body?.sessions || []).filter((s: any) => s.status === 'pending' || s.status === 'in_progress');
    // One product may legitimately sit at two SPOTS within one count (fridge and
    // dry store). What must never happen is the same product in two COUNTS.
    const seen = new Map<number, number>();
    for (const s of openNow) {
      for (const pid of new Set(await linesOf(s.id))) {
        expect(seen.get(pid), `product ${pid} is in two open counts`).toBeUndefined();
        seen.set(pid, s.id);
      }
    }
    console.log('invariant holds across', openNow.length, 'open counts /', seen.size, 'products');

    // Because they no longer overlap, staff walk them as ONE list.
    const group = (after.body?.walk_groups || []).find((g: number[]) => g.includes(newId) && g.includes(live[0].id));
    expect(group, 'today’s counts share one walk — each place visited once').toBeTruthy();

    // And what staff actually see on the phone.
    // Sign in through the page's OWN request context so the session cookie lands
    // in the browser — the sign-in screen itself is name+PIN and is not what this
    // test is about.
    const signIn = await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: 'biz@krawings.de', password: 'test1234' },
    });
    expect(signIn.status(), 'browser sign-in').toBe(200);
    await page.goto('/inventory');
    await expect(page.getByText(/count/i).first(), 'the inventory landing shows today’s counts')
      .toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: 'test-results/one-per-day-landing.png', fullPage: true });
  } finally {
    if (listId) await api(rq, `/api/inventory/templates?id=${listId}`, 'DELETE');
  }
});
