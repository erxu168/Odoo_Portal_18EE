/**
 * YIELD — what a kilo of food is really worth once the bin gets its share.
 *
 * Ethan, 2026-08-07: "When I buy plantain the price is by kilo. However the
 * kilo I buy cannot be used because there is peel that is not usable... what I
 * want is calculate the true cost of the product."
 *
 * A yield test is one weighing session: weigh the crate as it arrives, COUNT
 * THE PIECES, prep it, weigh what is left. Three numbers, two answers:
 *
 *   1. yield %      — 2.55 kg out of 4.00 kg is 64%, so the true cost of the
 *                     food that reaches a plate is the purchase price / 0.64.
 *   2. kg per piece — 4.00 kg / 12 plantains = 0.333 kg each. This is the SAME
 *                     number as `product_flags.units_per_crate` for a product
 *                     stored by weight and counted by the piece, where it is
 *                     currently typed in from memory.
 *
 * WHY MEASURE-BASED PRODUCTS ONLY (see `eligibility`): a yield test divides
 * "what came out" by "what went in", which is only a ratio when both are the
 * same unit. Plantains are stored in kg, so 2.55 kg / 4.00 kg = 64%. A product
 * stored in Units — "Mix Salat Kiste" — would be one crate in and 3.2 kg out,
 * and 3.2 kg / 1 crate is not a percentage.
 *
 * WHY THAT IS NOT ENOUGH TO CHANGE A PACK SIZE. A weight base rules out "1
 * crate = 20 bottles", but it does NOT rule out a pack whose weight is
 * DECLARED rather than remembered. This catalogue has "Ketchup 10kg Eimer",
 * "Carrots Sack 10 Kg" and "Zucchini 5 Kg Kiste" — all kg, all with an exact
 * pack weight on the label. Weigh three buckets, find 9.85 kg, and a purely
 * measurement-driven portal would offer to replace a correct 10 with the
 * suppliers' fill tolerance, quietly skewing every future count. Nothing in the
 * data distinguishes a declared 10 kg from a remembered 0.030 kg, so a person
 * is asked, once, per product: `packVaries`. Until they answer, no offer.
 * (Codex raised this on 2026-08-08; the examples above are real rows.)
 */

import { baseIsMeasure, hasCrate, round2, roundQty } from './crate-units';

/** One weighing session, as stored. Quantities are in the product's base UoM. */
export interface YieldTest {
  id: number;
  odoo_product_id: number;
  company_id: number;
  /** As it arrived, before prep. */
  raw_qty: number;
  /** How many whole things that was — null when nobody counted. */
  pieces: number | null;
  /** What was left that can actually be cooked. */
  usable_qty: number;
  note: string | null;
  created_at: string;
  created_by: number | null;
  created_by_name?: string | null;
}

/** A test the user is trying to save, before it is trusted. */
export interface YieldTestInput {
  raw_qty: number;
  pieces?: number | null;
  usable_qty: number;
  note?: string | null;
}

/** How many tests before the portal will offer to change a pack size. */
export const MIN_TESTS_FOR_PACK = 3;

/**
 * A measured pack size has to differ from the typed one by more than this
 * before it is worth anyone's attention — re-confirming 0.0301 against 0.0300
 * is noise, and a prompt that appears for no reason gets dismissed reflexively.
 */
const PACK_MEANINGFUL_DIFF = 0.02;   // 2%

/**
 * Only the most recent tests count. Produce changes — a new supplier, a new
 * season — and an average pooled over every test ever taken would be anchored
 * to plantains bought two years ago and would move more slowly the longer the
 * product had been measured, which is backwards.
 */
export const ROLLING_WINDOW = 10;

/** Beyond this spread the pieces are too inconsistent to average quietly. */
export const WIDE_SPREAD_PCT = 25;

export interface YieldSummary {
  /** Tests behind these numbers. */
  count: number;
  /** Of those, how many recorded a piece count. */
  countWithPieces: number;
  /** Pooled: total usable / total raw, as a fraction 0..1. Null with no tests. */
  fraction: number | null;
  /** The same as a percentage, rounded for display. */
  pct: number | null;
  /** Pooled kg per piece, raw. Null when no test counted pieces. */
  perPieceRaw: number | null;
  /** Pooled kg per piece, usable. */
  perPieceUsable: number | null;
  /** Lightest and heaviest single-test piece weight — "is this consistent?" */
  perPieceMin: number | null;
  perPieceMax: number | null;
  /** Spread as a percentage of the average, so a manager can judge the number. */
  perPieceSpreadPct: number | null;
  /** Total weighed, for "how much is this average based on". */
  totalRaw: number;
  totalUsable: number;
  /** Tests on record but outside the rolling window, so the count adds up. */
  older: number;
}

const EMPTY: YieldSummary = {
  count: 0, countWithPieces: 0, fraction: null, pct: null,
  perPieceRaw: null, perPieceUsable: null,
  perPieceMin: null, perPieceMax: null, perPieceSpreadPct: null,
  totalRaw: 0, totalUsable: 0, older: 0,
};

/**
 * Roll a product's tests into one set of numbers.
 *
 * POOLED, not the mean of the ratios: a 20 kg test and a 1 kg test are not
 * equally good evidence, and pooling weights each by how much food it actually
 * measured. It is also the number a chef would work out by hand — everything
 * weighed in, everything weighed out.
 *
 * Nothing is discarded as an outlier. A wild test usually means the food really
 * was wild that week, and silently dropping the manager's own measurement is
 * how a tool loses trust; the spread is reported instead so they can see it and
 * delete the test themselves if it was a mistake.
 */
export function summarise(tests: readonly YieldTest[], window = ROLLING_WINDOW): YieldSummary {
  // Callers hand these over newest-first (the query orders by created_at DESC),
  // but sort here anyway rather than trust it: a caller that passed them the
  // other way round would silently average the OLDEST ten and nothing on screen
  // would look wrong.
  const all = tests.filter(t => t.raw_qty > 0 && t.usable_qty >= 0)
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
  const usable = all.slice(0, Math.max(1, window));
  if (!usable.length) return { ...EMPTY };
  const older = all.length - usable.length;

  const totalRaw = usable.reduce((a, t) => a + t.raw_qty, 0);
  const totalUsable = usable.reduce((a, t) => a + t.usable_qty, 0);

  const withPieces = usable.filter(t => typeof t.pieces === 'number' && (t.pieces as number) > 0);
  const pieceRaw = withPieces.reduce((a, t) => a + t.raw_qty, 0);
  const pieceUsableQty = withPieces.reduce((a, t) => a + t.usable_qty, 0);
  const pieces = withPieces.reduce((a, t) => a + (t.pieces as number), 0);

  const each = withPieces.map(t => t.raw_qty / (t.pieces as number));
  const perPieceRaw = pieces > 0 ? roundQty(pieceRaw / pieces) : null;
  const perPieceUsable = pieces > 0 ? roundQty(pieceUsableQty / pieces) : null;
  const min = each.length ? Math.min(...each) : null;
  const max = each.length ? Math.max(...each) : null;

  return {
    count: usable.length,
    countWithPieces: withPieces.length,
    fraction: totalRaw > 0 ? totalUsable / totalRaw : null,
    pct: totalRaw > 0 ? round2((totalUsable / totalRaw) * 100) : null,
    perPieceRaw,
    perPieceUsable,
    perPieceMin: min != null ? roundQty(min) : null,
    perPieceMax: max != null ? roundQty(max) : null,
    // Spread against the POOLED average, which is the number on screen — against
    // the mean of the ratios it would describe a figure nobody is shown.
    perPieceSpreadPct: min != null && max != null && perPieceRaw
      ? round2(((max - min) / perPieceRaw) * 100)
      : null,
    totalRaw: roundQty(totalRaw),
    totalUsable: roundQty(totalUsable),
    older,
  };
}

/**
 * What one usable kilo actually costs, given what a purchased kilo costs.
 * Null when either number is missing or the yield is zero — a product with no
 * usable part has no meaningful cost per usable kilo, and dividing by it gives
 * Infinity, which must never reach a screen as a price.
 */
export function trueCost(purchasePrice: number | null | undefined, fraction: number | null): number | null {
  if (typeof purchasePrice !== 'number' || !Number.isFinite(purchasePrice) || purchasePrice <= 0) return null;
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction <= 0) return null;
  const cost = purchasePrice / fraction;
  // Both operands can be finite and the quotient still overflow — a yield of
  // 1e-308 gives Infinity, and "\u20acInfinity / kg" is not a price. Checking the
  // RESULT is the only guard that holds. (Codex, 2026-08-08.)
  if (!Number.isFinite(cost)) return null;
  return Math.round(cost * 100) / 100;
}

/** Everything wrong with a test, in the words the person typing it needs. */
export function validate(input: YieldTestInput): string | null {
  const { raw_qty, usable_qty } = input;
  const pieces = input.pieces;
  if (!Number.isFinite(raw_qty) || raw_qty <= 0) return 'Enter what the raw amount weighed.';
  if (!Number.isFinite(usable_qty) || usable_qty < 0) return 'Enter what was left after prep.';
  // The one impossible reading. Usually a swap — the two weights typed the
  // wrong way round — so say that rather than "invalid input".
  if (usable_qty > raw_qty) {
    return 'The usable amount is heavier than the raw amount. Are the two weights the wrong way round?';
  }
  if (pieces != null) {
    if (!Number.isFinite(pieces) || pieces < 0) return 'Enter how many pieces, or leave it empty.';
    if (pieces > 0 && !Number.isInteger(pieces)) return 'Pieces must be a whole number.';
    if (pieces > 100000) return 'That is more pieces than a kitchen holds — check the number.';
  }
  if (raw_qty > 1e6) return 'That is a very large amount — check the number.';
  return null;
}

/** Zero pieces and "not counted" are the same fact; store one of them. */
export function normalisePieces(pieces: number | null | undefined): number | null {
  if (pieces == null || !Number.isFinite(pieces) || pieces <= 0) return null;
  return Math.round(pieces);
}

export interface Eligibility {
  /** Can this product have yield tests at all? */
  canTest: boolean;
  /** Why not, in plain words, when it cannot. */
  reason: string | null;
}

/**
 * Whether a yield test means anything for this product — see the note at the
 * top of the file. Weight and volume only.
 */
export function eligibility(uom: string | null | undefined): Eligibility {
  const unit = (uom || '').trim();
  if (!unit) return { canTest: false, reason: 'This product has no unit of measure yet.' };
  if (!baseIsMeasure(unit)) {
    return {
      canTest: false,
      reason: `This product is counted in ${unit}, not by weight. A yield test compares `
        + 'what came out against what went in, which only works when both are weighed.',
    };
  }
  return { canTest: true, reason: null };
}

export interface PackOffer {
  /** The number the tests measured. */
  measured: number;
  /** What is stored today — null when nobody has set a pack size. */
  current: number | null;
  /** How far off the stored number is, as a percentage of the measured one. */
  offByPct: number | null;
  /** True when there is no pack size at all, so this would be setting the first. */
  isFirst: boolean;
  /** Tests behind the measurement. */
  tests: number;
  /** Widest single-test piece weight range, for showing consistency. */
  min: number | null;
  max: number | null;
  spreadPct: number | null;
  /** The pieces disagree enough that the average deserves a second look. */
  wideSpread: boolean;
}

/**
 * Whether to ask "does one of these always weigh about the same, or is that
 * figure exact?" — the question that separates a remembered 0.030 kg bunch from
 * a declared 10 kg bucket. Asked ONCE per product, and only when there is
 * finally something to decide: enough tests to matter, and nobody has said yet.
 */
export function needsPackClassification(
  uom: string | null | undefined,
  packVaries: boolean | null | undefined,
  s: YieldSummary,
): boolean {
  if (!eligibility(uom).canTest) return false;
  if (packVaries != null) return false;                       // already answered
  if (s.countWithPieces < MIN_TESTS_FOR_PACK) return false;
  return !!s.perPieceRaw && s.perPieceRaw > 0;
}

/**
 * Should the portal offer to replace the typed pack size with the measured one?
 *
 * Returns null unless ALL of these hold, because writing this number wrong
 * silently corrupts every future count of the product:
 *  - the base unit is a weight/volume, so the pack size IS a measurement and
 *    not an exact count of bottles;
 *  - somebody has confirmed the pack VARIES, so it is a thing worth measuring
 *    rather than a figure the supplier declares (see needsPackClassification);
 *  - at least MIN_TESTS_FOR_PACK tests recorded pieces — one box of unusually
 *    big plantains must not be able to move the number;
 *  - the measured figure actually differs from the stored one.
 *
 * Uses RAW kg per piece, never usable: staff count whole unpeeled plantains on
 * a shelf, so the number that converts their count to kilos has to describe
 * what they are looking at. Only the costing uses the usable figure.
 *
 * It never writes anything. A manager confirms, always.
 */
export function packOffer(
  uom: string | null | undefined,
  currentUnitsPerCrate: number | null | undefined,
  s: YieldSummary,
  packVaries: boolean | null | undefined,
): PackOffer | null {
  if (!eligibility(uom).canTest) return null;
  if (packVaries !== true) return null;
  if (s.countWithPieces < MIN_TESTS_FOR_PACK) return null;
  if (!s.perPieceRaw || s.perPieceRaw <= 0) return null;

  const current = hasCrate(currentUnitsPerCrate) ? currentUnitsPerCrate : null;
  if (current != null) {
    const off = Math.abs(current - s.perPieceRaw) / s.perPieceRaw;
    if (off <= PACK_MEANINGFUL_DIFF) return null;   // already right
  }

  return {
    measured: s.perPieceRaw,
    current,
    offByPct: current != null ? round2(((current - s.perPieceRaw) / s.perPieceRaw) * 100) : null,
    isFirst: current == null,
    tests: s.countWithPieces,
    min: s.perPieceMin,
    max: s.perPieceMax,
    spreadPct: s.perPieceSpreadPct,
    wideSpread: (s.perPieceSpreadPct ?? 0) > WIDE_SPREAD_PCT,
  };
}

/**
 * A stored par re-expressed for a new pack size, so a manager who asked for
 * "10 bunches on hand" still has 10 bunches on hand afterwards.
 *
 * Par is STORED in base units but a measure-based product is ENTERED and SHOWN
 * in packs (`parEntryFactor` in crate-units). So changing 1 bunch from 0.030 kg
 * to 0.026 kg leaves the stored 0.30 kg alone but silently turns a par of "10
 * bunches" into "11.5 bunches" on screen — the manager's intent, expressed in
 * the only unit they ever saw, quietly changed because a different number moved.
 * Rescaling keeps the pack figure fixed and moves the base instead.
 */
export function rescalePar(basePar: number | null | undefined, from: number, to: number): number | null {
  if (basePar == null || !Number.isFinite(basePar)) return null;
  if (!hasCrate(from) || !hasCrate(to)) return null;
  return roundQty((basePar / from) * to);
}
