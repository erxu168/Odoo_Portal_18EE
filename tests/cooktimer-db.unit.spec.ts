import { test, expect } from '@playwright/test';
import { getDb } from '../src/lib/db';
import {
  listStations, getActiveProfilesByProduct, createTimer, advanceTimer,
  setTimerMute, cancelTimer, finishTimer, getReadyLineIds, getClaimedLineIds,
  createProfile, deleteProfile, listProfilesAdmin, createStation, deleteStation, createTimerBatches,
} from '../src/lib/cooktimer-db';

// Drives the real SQLite state machine end to end (no Odoo). Uses out-of-range
// synthetic line/order ids so it never collides with real feed data.
//
// The fixture profile is CREATED here rather than relying on the seeded ones:
// placeholder profiles only seed against the staging Odoo host, so a fresh
// database (a clean clone, CI) has none and these tests must not depend on it.
const FRIES_PRODUCT = 990_1682; // synthetic product id — never a real till product

const FIXTURE_STATION = '__cooktimer-db spec station';

/**
 * A 3-step profile (1st Fry / Rest / 2nd Fry) owned by this spec, on its OWN
 * station. It gets a dedicated station because a sibling spec asserts on station
 * profile counts and deletes stations — parking a profile on a shared station
 * raced it.
 */
function ensureFixtureProfile(): void {
  if (getActiveProfilesByProduct().has(FRIES_PRODUCT)) return;
  const stationId = listStations(false).find(s => s.name === FIXTURE_STATION)?.id
    ?? createStation(FIXTURE_STATION).id;
  if (!stationId) throw new Error('could not create the fixture station');
  createProfile({
    odooProductId: FRIES_PRODUCT,
    name: '__test French Fries',
    stationId,
    maxBatch: null,
    active: true,
    steps: [
      { label: '1st Fry', stepType: 'cook', durationSeconds: 210 },
      { label: 'Rest', stepType: 'rest', durationSeconds: 120 },
      { label: '2nd Fry', stepType: 'cook', durationSeconds: 150 },
    ],
  });
}

// These spec files share ONE real SQLite file and Playwright runs them in
// parallel workers, so every mutation here is scoped to THIS spec's own product
// id. An earlier broad "delete anything named __test*" sweep raced a sibling
// spec's fixtures and failed it.
test.beforeAll(ensureFixtureProfile);

test.afterAll(() => {
  const mine = listProfilesAdmin().find(p => p.odooProductId === FRIES_PRODUCT);
  if (mine) { try { deleteProfile(mine.id); } catch { /* a timer still references it — sweepSynthetic clears that */ } }
  const st = listStations(false).find(s => s.name === FIXTURE_STATION);
  if (st) { try { deleteStation(st.id); } catch { /* still in use */ } }
});
/**
 * Exactly the ids THIS file uses — not a range. cooktimer-setup.unit.spec.ts
 * also works in the 990xxx space (990901), and these files share one database:
 * a range sweep reached into its timer mid-test and made it fail.
 */
const SYNTHETIC_IDS = [990001, 990101, 990201, 990301, 990401, 990501, 990502, 990503, 990601];

function cleanup(orderIds: number[], timerId: number) {
  const db = getDb();
  db.prepare('DELETE FROM cook_timers WHERE id = ?').run(timerId);
  for (const o of orderIds) db.prepare('DELETE FROM kds_line_ready WHERE pos_order_id = ?').run(o);
}

/**
 * Remove every synthetic row, whoever left it.
 *
 * These tests share one real SQLite file, and starting a timer CLAIMS its line.
 * Each test used to tidy up on its last line, so a failed assertion skipped the
 * tidying and left a running timer holding that line — and the next run failed
 * at "createTimer returned null", planting the same seed again. One failure
 * poisoned the file until somebody deleted the row by hand.
 *
 * Running before as well as after means a file already in that state heals
 * itself rather than needing surgery.
 */
function sweepSynthetic() {
  const db = getDb();
  const mine = new Set(SYNTHETIC_IDS);
  const stale = db.prepare('SELECT id, pos_line_ids_json FROM cook_timers').all() as
    { id: number; pos_line_ids_json: string }[];
  for (const row of stale) {
    let lines: { lineId?: number }[] = [];
    try { lines = JSON.parse(row.pos_line_ids_json || '[]'); } catch { continue; }
    if (lines.some((l) => mine.has(Number(l?.lineId)))) {
      db.prepare('DELETE FROM cook_timers WHERE id = ?').run(row.id);
    }
  }
  const q = SYNTHETIC_IDS.map(() => '?').join(',');
  db.prepare(`DELETE FROM kds_line_ready WHERE pos_order_id IN (${q})`).run(...SYNTHETIC_IDS);
}

test.beforeEach(sweepSynthetic);
test.afterEach(sweepSynthetic);
const line = (lineId: number, orderId: number) => [{ lineId, orderId, ref: `#T${orderId}`, qty: 1, arrivedMs: 1_700_000_000_000 }];

test('stations are seeded and a profile maps a product to an ordered step chain', () => {
  expect(listStations().length).toBeGreaterThanOrEqual(3);
  const profs = getActiveProfilesByProduct();
  expect(profs.size).toBeGreaterThan(0);
  const fries = profs.get(FRIES_PRODUCT);
  expect(fries?.steps.length).toBe(3);
  expect(fries?.steps.map(s => s.label)).toEqual(['1st Fry', 'Rest', '2nd Fry']);
});

test('full cook flow: start -> advance x2 -> finish writes kds_line_ready', () => {
  const fries = getActiveProfilesByProduct().get(FRIES_PRODUCT)!;
  const [L, O] = [990001, 990001];
  const t = createTimer(fries.id, fries.stationId, line(L, O))!;
  expect(t).toBeTruthy();
  expect(t.currentStep).toBe(0);
  expect(getClaimedLineIds().has(L)).toBe(true); // excluded from the queue while running

  // Stale/duplicate advance (wrong expected step) is a safe no-op.
  expect(advanceTimer(t.id, 5)!.currentStep).toBe(0);

  expect(advanceTimer(t.id, 0)!.currentStep).toBe(1);
  expect(advanceTimer(t.id, 1)!.currentStep).toBe(2);

  const fin = advanceTimer(t.id, 2)!; // advancing the last step finishes
  expect(fin.state).toBe('finished');
  expect(getReadyLineIds().has(L)).toBe(true);

  // Finish is idempotent.
  expect(finishTimer(t.id)!.state).toBe('finished');
  cleanup([O], t.id);
  expect(getReadyLineIds().has(L)).toBe(false);
});

test('finishTimer refuses to complete before the last step (no premature ready rows)', () => {
  const fries = getActiveProfilesByProduct().get(FRIES_PRODUCT)!; // 3 steps
  const [L, O] = [990401, 990401];
  const t = createTimer(fries.id, fries.stationId, line(L, O))!;

  // At step 0 (not the last step), a stray finish must be a no-op — no ready row.
  const early = finishTimer(t.id, 0)!;
  expect(early.state).toBe('running');
  expect(getReadyLineIds().has(L)).toBe(false);

  // Walk to the last step, then finish succeeds and writes the ready row.
  advanceTimer(t.id, 0);
  advanceTimer(t.id, 1);
  const fin = finishTimer(t.id, 2)!;
  expect(fin.state).toBe('finished');
  expect(getReadyLineIds().has(L)).toBe(true);

  cleanup([O], t.id);
});

test('mute is reset on advance and a stale mute is rejected (decision 8)', () => {
  const fries = getActiveProfilesByProduct().get(FRIES_PRODUCT)!;
  const [L, O] = [990101, 990101];
  const t = createTimer(fries.id, fries.stationId, line(L, O))!;

  expect(setTimerMute(t.id, 0, true)!.muted).toBe(true);
  expect(advanceTimer(t.id, 0)!.muted).toBe(false);        // advance clears mute
  expect(setTimerMute(t.id, 0, true)!.muted).toBe(false);  // stale (step moved) -> rejected
  expect(setTimerMute(t.id, 1, true)!.muted).toBe(true);   // current step -> applied

  cleanup([O], t.id);
});

test('atomic claim: a second start over the same line returns null', () => {
  const fries = getActiveProfilesByProduct().get(FRIES_PRODUCT)!;
  const [L, O] = [990201, 990201];
  const t1 = createTimer(fries.id, fries.stationId, line(L, O));
  expect(t1).toBeTruthy();
  expect(createTimer(fries.id, fries.stationId, line(L, O))).toBeNull(); // already claimed
  cleanup([O], t1!.id);
});

test('cancel releases the line back to the queue and marks nothing ready', () => {
  const fries = getActiveProfilesByProduct().get(FRIES_PRODUCT)!;
  const [L, O] = [990301, 990301];
  const t = createTimer(fries.id, fries.stationId, line(L, O))!;
  expect(getClaimedLineIds().has(L)).toBe(true);
  cancelTimer(t.id);
  expect(getClaimedLineIds().has(L)).toBe(false); // re-enters the queue
  expect(getReadyLineIds().has(L)).toBe(false);   // not marked ready
  cleanup([O], t.id);
});

test('createTimerBatches makes one timer per basket, atomically', () => {
  const fries = getActiveProfilesByProduct().get(FRIES_PRODUCT)!;
  const mk = (id: number) => ({ lineId: id, orderId: id, ref: `#B${id}`, qty: 1, arrivedMs: 1_700_000_000_000 + id });
  const batches = [[mk(990501), mk(990502)], [mk(990503)]];

  const timers = createTimerBatches(fries.id, fries.stationId, batches);
  expect(timers.length).toBe(2);
  expect(timers[0].lines.map(l => l.lineId)).toEqual([990501, 990502]);
  expect(timers[1].lines.map(l => l.lineId)).toEqual([990503]);
  // Every line is claimed, so none re-enters the TO COOK queue.
  const claimed = getClaimedLineIds();
  for (const id of [990501, 990502, 990503]) expect(claimed.has(id)).toBe(true);

  // A second identical request claims nothing (no double-start across tablets).
  expect(createTimerBatches(fries.id, fries.stationId, batches).length).toBe(0);

  const db = getDb();
  for (const t of timers) db.prepare('DELETE FROM cook_timers WHERE id = ?').run(t.id);
});

test('createTimerBatches never puts the same line in two baskets', () => {
  const fries = getActiveProfilesByProduct().get(FRIES_PRODUCT)!;
  const dup = { lineId: 990601, orderId: 990601, ref: '#D', qty: 1, arrivedMs: 1_700_000_000_000 };
  const timers = createTimerBatches(fries.id, fries.stationId, [[dup], [dup]]);
  expect(timers.length).toBe(1); // the second basket's only line was already claimed
  const db = getDb();
  for (const t of timers) db.prepare('DELETE FROM cook_timers WHERE id = ?').run(t.id);
});
