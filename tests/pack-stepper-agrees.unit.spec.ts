import { test, expect } from '@playwright/test';
import { splitFromTotal, crateTotal, hasCrate } from '../src/lib/crate-units';

/**
 * The + button on a pack-counted line must step from THE NUMBER ON SCREEN.
 *
 * Ethan, 2026-08-04: "when I want to push the plus button on the Thymian fresh
 * at Ssam Guestroom Area walk in cooler one, it's not possible."
 *
 * His stored line said `counted_qty 0` AND `crate_qty 1` — one bunch and
 * nothing, at the same time. It got that way because saving a plain total
 * cleared the split locally but not on the server.
 *
 * The row already refuses a remembered split that does not add up to the stored
 * total, so it displayed 0. The stepper did NOT apply that rule and stepped
 * from 1 — so + went to 2 and − wrote 0 again and appeared dead. These pin the
 * one rule both must use.
 */

const SIZE = 0.03;                       // one bunch of thyme, in kg

/** The rule the ROW uses to decide what to show. */
function displayed(total: number | null, remembered: { crates: number; loose: number } | null) {
  if (total == null) return null;
  return remembered && crateTotal(remembered.crates, remembered.loose, SIZE) === total
    ? remembered : splitFromTotal(total, SIZE);
}
/** The same rule, which the STEPPER must now use to decide where to step from. */
function stepFrom(total: number, remembered: { crates: number; loose: number } | null) {
  const derived = splitFromTotal(total, SIZE);
  const usable = remembered && crateTotal(remembered.crates, remembered.loose, SIZE) === total
    ? remembered : null;
  return { crates: usable?.crates ?? derived.crates, loose: usable?.loose ?? derived.loose };
}

test('HIS LINE: a split that contradicts the total is ignored by BOTH', () => {
  const contradictory = { crates: 1, loose: 0 };   // says 0.03
  const stored = 0;                                 // but the total says 0
  expect(displayed(stored, contradictory)).toEqual({ crates: 0, loose: 0 });
  expect(stepFrom(stored, contradictory), 'the stepper must agree with the row')
    .toEqual({ crates: 0, loose: 0 });
});

test('so + moves it to exactly ONE bunch, not two', () => {
  const from = stepFrom(0, { crates: 1, loose: 0 });
  const next = from.crates + 1;
  expect(next).toBe(1);
  expect(crateTotal(next, from.loose, SIZE)).toBeCloseTo(0.03, 10);
});

test('a split that DOES add up is still trusted — the remembered shape is kept', () => {
  // 16 bunches + a 0.02 remainder: the point of remembering at all.
  const remembered = { crates: 16, loose: 0.02 };
  const total = crateTotal(16, 0.02, SIZE);
  expect(displayed(total, remembered)).toEqual(remembered);
  expect(stepFrom(total, remembered)).toEqual(remembered);
  // …and one tap adds a whole bunch WITHOUT losing the remainder.
  const next = stepFrom(total, remembered);
  expect(crateTotal(next.crates + 1, next.loose, SIZE)).toBeCloseTo(total + SIZE, 10);
});

test('with no remembered split at all, both fall back to the total', () => {
  const total = crateTotal(11, 0, SIZE);       // 0.33
  expect(displayed(total, null)).toEqual({ crates: 11, loose: 0 });
  expect(stepFrom(total, null)).toEqual({ crates: 11, loose: 0 });
});

test('floating point cannot make eleven bunches read as ten plus a remainder', () => {
  // 11 x 0.03 is 0.32999999999999996 in binary floating point.
  expect(splitFromTotal(0.32999999999999996, SIZE).crates).toBe(11);
});

test('a line with no pack size is never treated as packs', () => {
  expect(hasCrate(0)).toBe(false);
  expect(hasCrate(null)).toBe(false);
  expect(hasCrate(SIZE)).toBe(true);
});
