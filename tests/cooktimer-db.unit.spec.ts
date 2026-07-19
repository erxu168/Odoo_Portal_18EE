import { test, expect } from '@playwright/test';
import { getDb } from '../src/lib/db';
import {
  listStations, getActiveProfilesByProduct, createTimer, advanceTimer,
  setTimerMute, cancelTimer, finishTimer, getReadyLineIds, getClaimedLineIds,
} from '../src/lib/cooktimer-db';

// Drives the real SQLite state machine end to end (no Odoo). Uses out-of-range
// synthetic line/order ids so it never collides with real feed data, and cleans
// up after itself.
const FRIES_PRODUCT = 1682; // seeded 3-step profile (1st Fry / Rest / 2nd Fry)

function cleanup(orderIds: number[], timerId: number) {
  const db = getDb();
  db.prepare('DELETE FROM cook_timers WHERE id = ?').run(timerId);
  for (const o of orderIds) db.prepare('DELETE FROM kds_line_ready WHERE pos_order_id = ?').run(o);
}
const line = (lineId: number, orderId: number) => [{ lineId, orderId, ref: `#T${orderId}`, qty: 1, arrivedMs: 1_700_000_000_000 }];

test('seeds three stations and product-mapped profiles', () => {
  expect(listStations().length).toBeGreaterThanOrEqual(3);
  const profs = getActiveProfilesByProduct();
  expect(profs.size).toBeGreaterThan(0);
  expect(profs.get(FRIES_PRODUCT)?.steps.length).toBe(3);
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
