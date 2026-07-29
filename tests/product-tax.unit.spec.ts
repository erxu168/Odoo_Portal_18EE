import { test, expect } from '@playwright/test';
import {
  currentCompanyTax, hasConflictingTax, taxDiffCommands,
} from '../src/lib/product-tax';

/**
 * A product's taxes span every restaurant at once — one shared bottle of soy
 * sauce carries WAJ's tax, Ssam's and Krawings' in the same field. Setting one
 * restaurant's the obvious way deletes the others', and the damage is invisible
 * from the screen that causes it: it surfaces weeks later as an invoice with no
 * VAT on it, in somebody else's accounts.
 *
 * Modelled on the REAL staging data:
 *   WAJ (co 6)       : 226 sale 19%, 224 sale 19% incl, 227 purchase 7%
 *   Ssam (co 3)      : 124 sale 19%, 134 purchase 7%
 *   Krawings (co 2)  :  55 sale 19%
 */
const WAJ_SALE = [226, 224, 221, 232, 239];
const PRODUCT = [55, 124, 226];            // one tax each for Krawings, Ssam, WAJ

/* --- READING -------------------------------------------------------------- */

test('the active restaurant sees ITS tax, not whichever sorts first', () => {
  // 55 (Krawings) is first in the list. Reading position 0 — which the live POS
  // drinks editor does — shows a manager at WAJ another company's rate.
  expect(currentCompanyTax(PRODUCT, WAJ_SALE)).toBe(226);
});

test('no tax for this restaurant reads as none, never as someone else’s', () => {
  expect(currentCompanyTax([55, 124], WAJ_SALE)).toBeNull();
  expect(currentCompanyTax([], WAJ_SALE)).toBeNull();
});

test('a restaurant with no taxes configured reads none rather than guessing', () => {
  expect(currentCompanyTax(PRODUCT, [])).toBeNull();
});

test('two taxes for one restaurant is detectable, so the screen can say so', () => {
  expect(hasConflictingTax([55, 226, 224], WAJ_SALE)).toBe(true);
  expect(hasConflictingTax(PRODUCT, WAJ_SALE)).toBe(false);
});

/* --- WRITING -------------------------------------------------------------- *
 * Unlink/link commands, not a full SET. A full SET restates the WHOLE relation,
 * so it carries every other company's taxes through a read-modify-write and two
 * restaurants saving the same product seconds apart lose each other's change:
 *
 *   start        [WAJ-old, Ssam-old]
 *   WAJ  writes  [WAJ-new, Ssam-old]   (read before Ssam's write)
 *   Ssam writes  [WAJ-old, Ssam-new]   (read before WAJ's write) — WAJ reverted
 *
 * Separate RPC calls, no shared transaction, so no care in computing the final
 * list can prevent it. These pin that the write never NAMES another company's
 * tax, which is what makes the loss impossible rather than unlikely.
 * -------------------------------------------------------------------------- */

test('THE POINT: the write touches only this restaurant’s tax', () => {
  const cmds = taxDiffCommands(PRODUCT, WAJ_SALE, 224);
  expect(cmds).toEqual([[3, 226], [4, 224]]);       // 3 = unlink, 4 = link
  const named = cmds.map(([, id]) => id);
  expect(named, 'Krawings must never appear in the write').not.toContain(55);
  expect(named, 'Ssam must never appear in the write').not.toContain(124);
});

test('a concurrent edit by another restaurant cannot be reverted by this write', () => {
  // Ssam swapped 124 -> 134 after we read the product. A full SET built from our
  // stale read would write 124 back and undo them.
  const named = taxDiffCommands(PRODUCT, WAJ_SALE, 224).map(([, id]) => id);
  expect(named).not.toContain(124);
  expect(named).not.toContain(134);
});

test('a tax the portal has never heard of is left alone, not deleted', () => {
  // Added directly in Odoo, or belonging to a company this portal cannot see.
  const cmds = taxDiffCommands([...PRODUCT, 9999], WAJ_SALE, 224);
  expect(cmds.map(([, id]) => id)).not.toContain(9999);
});

test('clearing unlinks only this restaurant’s, and links nothing', () => {
  expect(taxDiffCommands(PRODUCT, WAJ_SALE, null)).toEqual([[3, 226]]);
});

test('clearing when this restaurant has no tax writes nothing at all', () => {
  expect(taxDiffCommands([55, 124], WAJ_SALE, null)).toEqual([]);
});

test('setting the tax it already has produces NO write', () => {
  expect(taxDiffCommands(PRODUCT, WAJ_SALE, 226)).toEqual([]);
});

test('a product carrying two of this restaurant’s taxes is repaired in one write', () => {
  const messy = [55, 226, 224];                     // two WAJ sale taxes
  expect(taxDiffCommands(messy, WAJ_SALE, 226)).toEqual([[3, 224]]);
});

test('a RETIRED tax of this restaurant is displaced once it is in the owned set', () => {
  // Real staging state: 92 products still carry WAJ sales tax 234, since
  // archived in Odoo. Ownership must be resolved with active_test off, or 234
  // looks like nobody's, survives the write, and the product ends up holding two
  // WAJ sales taxes at once.
  const RETIRED = 234;
  const owned = [...WAJ_SALE, RETIRED];

  // Resolved active-only: the retired tax is not recognised as ours and stays.
  expect(taxDiffCommands([55, RETIRED], WAJ_SALE, 226)).toEqual([[4, 226]]);
  // Resolved correctly: it is unlinked and replaced.
  expect(taxDiffCommands([55, RETIRED], owned, 226)).toEqual([[3, RETIRED], [4, 226]]);
});

test('a product with no taxes takes one cleanly', () => {
  expect(taxDiffCommands([], WAJ_SALE, 226)).toEqual([[4, 226]]);
});

test('another restaurant’s tax cannot be attached to this one', () => {
  // 124 is Ssam's. A hand-made request must not put it on WAJ's sales.
  expect(() => taxDiffCommands(PRODUCT, WAJ_SALE, 124)).toThrow(/TAX_NOT_IN_COMPANY/);
  expect(() => taxDiffCommands(PRODUCT, [], 226)).toThrow(/TAX_NOT_IN_COMPANY/);
});

test('every command is an unlink or a link — never a SET', () => {
  // A 6 here would reintroduce the whole-relation overwrite this replaced.
  for (const chosen of [224, 226, null]) {
    for (const [op] of taxDiffCommands([55, 124, 226, 232], WAJ_SALE, chosen)) {
      expect([3, 4], `command ${op} must be unlink(3) or link(4)`).toContain(op);
    }
  }
});

/* --- THE KNOWN LIMIT ------------------------------------------------------ *
 * Unlink/link makes cross-restaurant loss impossible. It does NOT make two
 * saves for the SAME restaurant safe. That is accepted deliberately: a post-write
 * tidy-up was tried and removed because both requests tidy, each unlinking what
 * it reads as the other's stray, and the restaurant can end with NO tax at all —
 * reproduced on staging, and worse than the duplicate.
 *
 * These pin the limit so it stays a known, detected state rather than a surprise.
 * -------------------------------------------------------------------------- */

test('two same-restaurant saves leave BOTH taxes linked — the accepted limit', () => {
  // Both read [55, 124, 226]. One picks 224, the other 232.
  const a = taxDiffCommands(PRODUCT, WAJ_SALE, 224);
  const b = taxDiffCommands(PRODUCT, WAJ_SALE, 232);
  let state = [...PRODUCT];
  for (const [op, id] of [...a, ...b]) {
    state = op === 3 ? state.filter((x) => x !== id) : [...state, id];
  }
  expect(state, 'one restaurant, two sale taxes').toEqual([55, 124, 224, 232]);
  // The screen detects it and says so, which is what makes the limit tolerable.
  expect(hasConflictingTax(state, WAJ_SALE)).toBe(true);
});

test('and even in that race, NO other restaurant loses anything', () => {
  // The whole point. Whatever order the two writes land in, neither names
  // Krawings' 55 or Ssam's 124, so both survive.
  const a = taxDiffCommands(PRODUCT, WAJ_SALE, 224);
  const b = taxDiffCommands(PRODUCT, WAJ_SALE, 232);
  for (const order of [[...a, ...b], [...b, ...a]]) {
    let state = [...PRODUCT];
    for (const [op, id] of order) {
      state = op === 3 ? state.filter((x) => x !== id) : [...state, id];
    }
    expect(state, 'Krawings survives every ordering').toContain(55);
    expect(state, 'Ssam survives every ordering').toContain(124);
  }
});

test('picking a rate afterwards repairs the duplicate in one write', () => {
  expect(taxDiffCommands([55, 124, 224, 232], WAJ_SALE, 232)).toEqual([[3, 224]]);
});
