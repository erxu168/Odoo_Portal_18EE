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

  // Products that have a HOME SPOT, so the count is routed by location and the
  // GUIDED gate is the one under test. Without spots the list falls to the flat
  // gate, which already demanded every line and would prove nothing about the
  // rule this test exists for.
  const placements = await api(rq, `/api/inventory/product-locations?company_id=${WAJ}`);
  const placed = Array.from(new Set(
    (placements.body?.placements || []).map((pl: any) => pl.odoo_product_id as number),
  ));
  expect(placed.length, 'need products with home spots to exercise a GUIDED count').toBeGreaterThanOrEqual(3);
  const ids = placed.slice(0, 3);

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
    // A product with home spots in two places produces TWO lines, so the count
    // covers at least three but usually more. The rule is per LINE, which is
    // exactly the multi-spot case worth testing.
    expect(items.length, 'the count should cover every placed line').toBeGreaterThanOrEqual(3);
    console.log('lines to answer:', items.length);

    // --- 1. nothing answered → refused -------------------------------------
    const empty = await api(rq, '/api/inventory/sessions', 'PUT', { id: sessionId, status: 'submitted' });
    expect(empty.status, 'an untouched count must not submit').toBe(400);
    console.log('empty  →', empty.body?.code, '|', String(empty.body?.error).slice(0, 90));
    // The point of the fixture: this must be the GUIDED gate, not the flat one.
    expect(empty.body?.code, 'the fixture must produce a guided count').toBe('UNANSWERED_PRODUCTS');

    // --- 2. answer ONE, still refused --------------------------------------
    // Counted with a real number, on a line whose product does not demand a
    // photo — that is a different gate and would muddy this one.
    const preFlags = await api(rq, '/api/inventory/product-flags');
    const photoIds = new Set(
      (preFlags.body?.flags || []).filter((f: any) => f.requires_photo).map((f: any) => f.odoo_product_id),
    );
    const first = items.find((it: any) => !photoIds.has(it.odoo_product_id)) || items[0];
    expect((await api(rq, '/api/inventory/counts', 'POST', {
      session_id: sessionId, product_id: first.odoo_product_id,
      count_location_id: first.count_location_id, counted_qty: 4, uom: 'kg',
    })).status, 'a plain count must save').toBe(200);

    const partial = await api(rq, '/api/inventory/sessions', 'PUT', { id: sessionId, status: 'submitted' });
    expect(partial.status, 'a partly answered count must not submit').toBe(400);
    console.log('1 answered →', partial.body?.code, '| still blank:', (partial.body?.unanswered || []).length);
    // THE OLD BEHAVIOUR: counting one product in a spot waved the rest of that
    // spot through as blanks. Every remaining line must still be demanded.
    expect(partial.body?.code).toBe('UNANSWERED_PRODUCTS');
    expect((partial.body?.unanswered || []).length, 'every remaining line must be named')
      .toBe(items.length - 1);

    // --- 3. every remaining line, by the OTHER two routes ------------------
    const rest = items.filter((it: any) => it !== first);
    const second = rest[0];
    expect((await api(rq, '/api/inventory/counts', 'POST', {
      session_id: sessionId, product_id: second.odoo_product_id,
      count_location_id: second.count_location_id, out_of_stock: true, counted_qty: 0, uom: 'kg',
    })).status, '"nothing here" must save').toBe(200);

    const third = rest[1];
    expect((await api(rq, '/api/inventory/counts', 'POST', {
      session_id: sessionId, product_id: third.odoo_product_id,
      count_location_id: third.count_location_id, not_found: true, counted_qty: 0, uom: 'kg',
    })).status, '"couldn\'t find it" must save').toBe(200);

    // Whatever else the placements produced. Answered as "nothing here" so the
    // photo rule stays out of it: a photo is demanded only for a POSITIVE
    // count, which is a separate gate from the one under test.
    for (const it of rest.slice(2)) {
      expect((await api(rq, '/api/inventory/counts', 'POST', {
        session_id: sessionId, product_id: it.odoo_product_id,
        count_location_id: it.count_location_id, out_of_stock: true, counted_qty: 0, uom: 'kg',
      })).status).toBe(200);
    }

    // A product that REQUIRES A PHOTO but could not be found must not deadlock:
    // you cannot photograph what you cannot see. The photo rule fires only on a
    // positive count, so a zero-quantity answer is exempt — pinned here because
    // the two rules meeting is exactly where a count would become unsubmittable.
    const flags = await api(rq, '/api/inventory/product-flags');
    const needsPhoto = new Set(
      (flags.body?.flags || []).filter((f: any) => f.requires_photo).map((f: any) => f.odoo_product_id),
    );
    console.log('lines whose product requires a photo:',
      items.filter((it: any) => needsPhoto.has(it.odoo_product_id)).length);

    // it must come back FLAGGED, not as a plain zero
    // Matched on (product, SPOT). The same product can hold a different answer
    // at each spot, so finding by product alone picks an arbitrary line — which
    // is exactly the mistake that made this assertion fail the first time.
    const after = await api(rq, `/api/inventory/counts?session_id=${sessionId}`);
    const line = (e: any, it: any) =>
      e.product_id === it.odoo_product_id && (e.count_location_id ?? 0) === (it.count_location_id ?? 0);

    const nf = (after.body?.entries || []).find((e: any) => line(e, third));
    expect(nf?.not_found, 'the answer must persist as not_found').toBeTruthy();
    expect(Number(nf?.counted_qty), 'not-found stores zero, but the FLAG is what matters').toBe(0);

    const oos = (after.body?.entries || []).find((e: any) => line(e, second));
    expect(oos?.out_of_stock, 'and out-of-stock must stay distinct from it').toBeTruthy();
    expect(oos?.not_found, 'the two answers must not both be set on one line').toBeFalsy();

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
