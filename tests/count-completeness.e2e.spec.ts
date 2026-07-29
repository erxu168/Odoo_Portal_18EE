import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Every product on a count must be answered before it can be submitted — and,
 * just as importantly, every product MUST be answerable.
 *
 * The second half is why this test exists. A submit gate on this module has
 * already deadlocked once: it demanded a stop status that no button could set,
 * so counts could not be submitted at all. Tightening the rule again without a
 * test that actually drives a count to a successful submit would be repeating
 * that. So this walks the whole thing: refuse an incomplete count, answer every
 * line by each of the three routes, and submit.
 *
 * Self-contained — creates its own list and session, removes them afterwards.
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

test('a count cannot be submitted with blanks, and every line can be answered', async ({ playwright }) => {
  const rq = await playwright.request.newContext();
  expect((await api(rq, '/api/auth/login', 'POST',
    { email: 'biz@krawings.de', password: 'test1234' })).status, 'login').toBe(200);

  const tmpls = await api(rq, `/api/inventory/templates?company_id=${WAJ}`);
  const model = (tmpls.body?.templates || [])[0];
  expect(model, 'need an existing list to copy location/company from').toBeTruthy();

  // Three products so "some answered, some not" is a real state.
  const prods = await api(rq, `/api/inventory/products?limit=500&company_id=${WAJ}&relevant=1`);
  const ids = (prods.body?.products || []).filter((p: any) => p.active !== false).slice(0, 3).map((p: any) => p.id);
  expect(ids.length, 'need three products').toBe(3);

  let templateId: number | null = null;
  try {
    const made = await api(rq, '/api/inventory/templates', 'POST', {
      name: `TEST completeness ${Date.now()}`,
      location_id: model.location_id,
      company_id: model.company_id,
      frequency: 'adhoc',
      adhoc_date: new Date().toISOString().slice(0, 10),
      product_ids: ids,
    });
    expect(made.status, 'create the list').toBe(201);
    templateId = made.body.id;
    const sessionId = made.body.session_id;

    const opened = await api(rq, `/api/inventory/counts?session_id=${sessionId}`);
    const items = opened.body?.items || [];
    expect(items.length, 'the count should cover all three').toBe(3);

    // --- 1. nothing answered → refused -------------------------------------
    const empty = await api(rq, '/api/inventory/sessions', 'PUT', { id: sessionId, status: 'submitted' });
    expect(empty.status, 'an untouched count must not submit').toBe(400);
    console.log('empty  →', empty.body?.code, '|', String(empty.body?.error).slice(0, 90));

    // --- 2. answer ONE, still refused --------------------------------------
    const first = items[0];
    expect((await api(rq, '/api/inventory/counts', 'POST', {
      session_id: sessionId, product_id: first.odoo_product_id,
      count_location_id: first.count_location_id, counted_qty: 4, uom: 'kg',
    })).status, 'a plain count must save').toBe(200);

    const partial = await api(rq, '/api/inventory/sessions', 'PUT', { id: sessionId, status: 'submitted' });
    expect(partial.status, 'a partly answered count must not submit').toBe(400);
    console.log('1 of 3 →', partial.body?.code, '| unanswered:', (partial.body?.unanswered || []).length);

    // --- 3. the other two, by the OTHER two routes -------------------------
    const second = items[1];
    expect((await api(rq, '/api/inventory/counts', 'POST', {
      session_id: sessionId, product_id: second.odoo_product_id,
      count_location_id: second.count_location_id, out_of_stock: true, counted_qty: 0, uom: 'kg',
    })).status, '"nothing here" must save').toBe(200);

    const third = items[2];
    expect((await api(rq, '/api/inventory/counts', 'POST', {
      session_id: sessionId, product_id: third.odoo_product_id,
      count_location_id: third.count_location_id, not_found: true, counted_qty: 0, uom: 'kg',
    })).status, '"couldn\'t find it" must save').toBe(200);

    // it must come back FLAGGED, not as a plain zero
    const after = await api(rq, `/api/inventory/counts?session_id=${sessionId}`);
    const nf = (after.body?.entries || []).find((e: any) => e.product_id === third.odoo_product_id);
    expect(nf?.not_found, 'the answer must persist as not_found').toBeTruthy();
    const oos = (after.body?.entries || []).find((e: any) => e.product_id === second.odoo_product_id);
    expect(oos?.out_of_stock, 'and out-of-stock must stay distinct from it').toBeTruthy();
    expect(oos?.not_found, 'the two answers must not both be set').toBeFalsy();

    // --- 4. all three answered → it submits. NO DEADLOCK. ------------------
    const done = await api(rq, '/api/inventory/sessions', 'PUT', { id: sessionId, status: 'submitted' });
    expect(done.status, `a fully answered count MUST submit (got: ${done.body?.error})`).toBe(200);
    console.log('all 3  → submitted');
  } finally {
    if (templateId) {
      const gone = await api(rq, `/api/inventory/templates?id=${templateId}`, 'DELETE');
      console.log('cleanup: deleted test list', templateId, '→', gone.status);
    }
    await rq.dispose();
  }
});
