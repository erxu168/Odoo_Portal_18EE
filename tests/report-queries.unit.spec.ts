import { test, expect } from '@playwright/test';

/**
 * The reports data layer must see EVERY row in the asked window. All five bulk
 * fetchers used `{ limit: 0 }`, which the Odoo client silently reads as 200 —
 * so every report built on them (daily, compare, records, dashboard, shift
 * busy-times) under-counted any range with more than 200 records. A WAJ
 * year-to-date is already past that line.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getOdoo } = require('../src/lib/odoo');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rq = require('../src/lib/report-queries');

const TOTAL = 450;

/** Cursor-aware fake serving TOTAL rows with shuffled-looking timestamps. */
let realSearchRead: unknown;
function installFake() {
  const inst = getOdoo();
  realSearchRead = (inst as any).searchRead;   // restored in afterAll — the singleton outlives this spec
  (inst as any).searchRead = async (_m: string, domain: unknown[][], _f: string[], opts: { limit?: number }) => {
    const cursorTerm = domain.find((t) => Array.isArray(t) && t[0] === 'id' && t[1] === '>');
    const after = cursorTerm ? Number(cursorTerm[2]) : 0;
    // Mirror the real client's falsy-limit bug: limit 0 becomes 200.
    const limit = opts.limit || 200;
    const out: { id: number; date_order: string }[] = [];
    for (let id = after + 1; id <= Math.min(after + limit, TOTAL); id++) {
      // Deliberately NOT ordered by id ↔ date: descending times prove sorting.
      out.push({ id, date_order: `2026-07-01 ${String(23 - (id % 24)).padStart(2, '0')}:00:00` });
    }
    return out;
  };
}

test.beforeAll(installFake);
test.afterAll(() => { (getOdoo() as any).searchRead = realSearchRead; });

test('fetchOrders returns every order in the window, oldest first', async () => {
  const rows = await rq.fetchOrders(6, '2026-01-01', '2026-07-31');
  expect(rows.length, 'all rows, not the first 200').toBe(TOTAL);
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].date_order >= rows[i - 1].date_order, `sorted at ${i}`).toBe(true);
  }
});

test('the other four bulk fetchers also see past 200', async () => {
  expect((await rq.fetchRefunds(6, '2026-01-01', '2026-07-31')).length).toBe(TOTAL);
  expect((await rq.fetchOrderLines(6, '2026-01-01', '2026-07-31')).length).toBe(TOTAL);
  expect((await rq.fetchPayments(6, '2026-01-01', '2026-07-31')).length).toBe(TOTAL);
  expect((await rq.fetchAccountMoveLines(6, '2026-01-01', '2026-07-31', ['expense'])).length).toBe(TOTAL);
});
