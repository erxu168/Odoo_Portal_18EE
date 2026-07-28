import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Counting a product that arrives NESTED — a Karton holds Beutel, a Beutel holds
 * kilos — must reach the database with the right total.
 *
 * This exists because that feature shipped COMPLETELY broken and nothing caught
 * it. Every nested save was rejected by the server (the two-level "crates +
 * loose" check fired on a line the nested chain had already converted), and the
 * counting screen reported success anyway — "1 of 1 counted" over an empty
 * count. Type-checking, the build and 255 unit tests were all green.
 *
 * Only driving the real endpoints found it, so that is what this does. It is
 * deliberately end-to-end rather than a unit test: the bug lived in the
 * agreement between the client's payload and the server's validation, which no
 * unit test of either side alone can see.
 *
 * Self-contained: it creates its own list, session and packaging chain, and
 * removes all of it afterwards even when an assertion fails.
 */

const BASE = process.env.PORTAL_URL || 'https://portal.krawings.de';
const WAJ = 6;

test.use({ baseURL: BASE });
test.setTimeout(180_000);

/** A real WAJ product that genuinely comes in a Karton of 5 × 2.5 kg. */
const PRODUCT = 1703;
const KARTON = 12.5;   // 5 Beutel × 2.5 kg
const BEUTEL = 2.5;

async function api(rq: APIRequestContext, path: string, method = 'GET', body?: unknown) {
  const r = await rq.fetch(`${BASE}${path}`, {
    method,
    data: body as any,
    headers: { 'Content-Type': 'application/json' },
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* empty body */ }
  return { status: r.status(), body: json };
}

test('a nested box/pack/piece count reaches the database with the right total', async ({ playwright }) => {
  const rq = await playwright.request.newContext();
  const login = await api(rq, '/api/auth/login', 'POST', { email: 'biz@krawings.de', password: 'test1234' });
  expect(login.status, 'login').toBe(200);

  // Reuse an existing list only for its location/company, so the fixture matches
  // how real lists are shaped rather than inventing values.
  const tmpls = await api(rq, `/api/inventory/templates?company_id=${WAJ}`);
  const model = (tmpls.body?.templates || [])[0];
  expect(model, 'need an existing list to copy location/company from').toBeTruthy();

  const today = new Date().toISOString().slice(0, 10);
  let templateId: number | null = null;
  let chainWasEmpty = false;

  try {
    // --- the chain this count will be judged against -----------------------
    const before = await api(rq, `/api/inventory/products/${PRODUCT}/packaging`);
    chainWasEmpty = (before.body?.levels || []).length === 0;
    const chain = await api(rq, `/api/inventory/products/${PRODUCT}/packaging`, 'PUT', {
      levels: [
        { name: 'Karton', to_base: KARTON, countable: true },
        { name: 'Beutel', to_base: BEUTEL, countable: true },
      ],
    });
    expect(chain.status, 'save the packaging chain').toBe(200);
    expect(chain.body?.problems ?? [], 'the chain must be valid').toEqual([]);

    // --- a list containing only that product, and today's count ------------
    const made = await api(rq, '/api/inventory/templates', 'POST', {
      name: `TEST nested count ${Date.now()}`,
      location_id: model.location_id,
      company_id: model.company_id,
      frequency: 'adhoc',
      adhoc_date: today,
      product_ids: [PRODUCT],
    });
    expect(made.status, 'create the list').toBe(201);
    templateId = made.body.id;
    const sessionId = made.body.session_id;
    expect(sessionId, 'creating the list must generate today’s count').toBeTruthy();

    // The chain must be FROZEN into the count — that frozen copy, not the
    // product's current settings, is what the server converts with.
    const opened = await api(rq, `/api/inventory/counts?session_id=${sessionId}`);
    const frozen = opened.body?.packaging?.[String(PRODUCT)] || [];
    expect(frozen.map((l: any) => `${l.name}=${l.toBase}`).sort())
      .toEqual(['Beutel=2.5', 'Karton=12.5']);

    // --- THE REGRESSION -----------------------------------------------------
    // 2 Kartons + 1 Beutel + 0 loose. The client sends per-level counts AND
    // loose_qty; loose_qty used to trip the two-level split check and the whole
    // save came back 400.
    const levelIds: Record<string, number> = {};
    frozen.forEach((l: any) => { levelIds[l.name] = l.id; });
    const saved = await api(rq, '/api/inventory/counts', 'POST', {
      session_id: sessionId,
      product_id: PRODUCT,
      count_location_id: 0,
      pack_counts: { [levelIds.Karton]: 2, [levelIds.Beutel]: 1 },
      loose_qty: 0,
      uom: 'kg',
    });
    expect(saved.status, `a nested count must be accepted (got: ${saved.body?.error})`).toBe(200);

    // --- and it must be STORED, at the total the chain implies --------------
    const after = await api(rq, `/api/inventory/counts?session_id=${sessionId}`);
    const entry = (after.body?.entries || []).find((e: any) => e.product_id === PRODUCT);
    expect(entry, 'the line must exist in the database, not just on screen').toBeTruthy();
    expect(Number(entry.counted_qty), '2 Kartons + 1 Beutel = 27.5 kg').toBe(2 * KARTON + BEUTEL);

    // --- loose units are added on top, not swallowed ------------------------
    const withLoose = await api(rq, '/api/inventory/counts', 'POST', {
      session_id: sessionId,
      product_id: PRODUCT,
      count_location_id: 0,
      pack_counts: { [levelIds.Karton]: 1 },
      loose_qty: 0.5,
      uom: 'kg',
    });
    expect(withLoose.status, 'a nested count WITH loose units must be accepted').toBe(200);
    const after2 = await api(rq, `/api/inventory/counts?session_id=${sessionId}`);
    const entry2 = (after2.body?.entries || []).find((e: any) => e.product_id === PRODUCT);
    expect(Number(entry2.counted_qty), '1 Karton + 0.5 kg loose = 13 kg').toBe(KARTON + 0.5);

    // --- the server converts, the client does not get to decide -------------
    // A caller claiming a Karton is worth 9999 must change nothing: the total
    // comes from the FROZEN chain.
    const liar = await api(rq, '/api/inventory/counts', 'POST', {
      session_id: sessionId,
      product_id: PRODUCT,
      count_location_id: 0,
      pack_counts: { [levelIds.Karton]: 1 },
      loose_qty: 0,
      units_per_crate: 9999,
      counted_qty: 9999,
      uom: 'kg',
    });
    expect(liar.status).toBe(200);
    const after3 = await api(rq, `/api/inventory/counts?session_id=${sessionId}`);
    const entry3 = (after3.body?.entries || []).find((e: any) => e.product_id === PRODUCT);
    expect(Number(entry3.counted_qty), 'the frozen chain decides the total, not the caller').toBe(KARTON);

    // --- and the guard I NARROWED must still bite --------------------------
    // The fix relaxed the two-level split check for lines a nested chain had
    // already converted. It must NOT have relaxed it for the case it exists to
    // catch: a crates-and-loose split sent for a product that has no pack size
    // on this count. If this ever returns 200, the check was removed rather
    // than narrowed, and a crate figure would be stored as if it were kilos.
    const noSuchSplit = await api(rq, '/api/inventory/counts', 'POST', {
      session_id: sessionId,
      product_id: PRODUCT,
      count_location_id: 0,
      crate_qty: 3,          // a two-level split...
      loose_qty: 1,
      counted_qty: 3,        // ...with a quantity, so it reaches the SPLIT check
      uom: 'kg',             //    rather than the earlier required-fields one
    });
    expect(noSuchSplit.status,
      'a crates+loose split with no pack size must still be refused').toBe(400);
    expect(String(noSuchSplit.body?.error)).toMatch(/not counted in packs/i);

    // The refused call must have changed nothing.
    const after4 = await api(rq, `/api/inventory/counts?session_id=${sessionId}`);
    const entry4 = (after4.body?.entries || []).find((e: any) => e.product_id === PRODUCT);
    expect(Number(entry4.counted_qty), 'a refused save must not alter the stored line').toBe(KARTON);
  } finally {
    // Leave staging exactly as found, pass or fail.
    if (templateId) {
      const gone = await api(rq, `/api/inventory/templates?id=${templateId}`, 'DELETE');
      console.log('cleanup: deleted test list', templateId, '→', gone.status);
    }
    if (chainWasEmpty) {
      await api(rq, `/api/inventory/products/${PRODUCT}/packaging`, 'PUT', { levels: [] });
      console.log('cleanup: removed the packaging chain it did not have before');
    }
    await rq.dispose();
  }
});
