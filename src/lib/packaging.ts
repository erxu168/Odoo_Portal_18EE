/**
 * Multi-level packaging <-> base-unit maths. No I/O — safe to unit test.
 *
 * A product arrives nested: a box holds packs, a pack holds pieces. The stock
 * ledger only ever stores the BASE unit (the piece), so this file is the single
 * answer to "what is this pile of boxes, packs and loose ones worth in base
 * units", and back again.
 *
 *   1 box  = 30 pieces
 *   1 pack = 10 pieces
 *   1 piece
 *   -> 2 boxes + 1 sealed pack + 4 loose = 74 pieces
 *
 * WHY `toBase` PER LEVEL, not "units per parent": a chain stored as factors has
 * to be multiplied up on every read, and editing a middle factor silently
 * rewrites every level above it. Storing each level's own base value keeps the
 * arithmetic flat and makes a bad row a bad row, never a bad chain.
 *
 * This GENERALISES crate-units.ts (one pack + loose), which stays the canonical
 * engine for the single-level products that are already configured. Both round
 * through the same roundQty, so a total always reads back as the count that
 * produced it.
 */

import { roundQty, round2, pluralizePack } from './crate-units';

export interface PackLevel {
  /** Row id — the key a count entry is stored against. */
  id: number;
  /** What one of these is called: "box", "pack", "crate". */
  name: string;
  /** How many BASE units one of these is. Must be finite and > 0. */
  toBase: number;
  /** May staff enter a number at this level? (A level can exist only to describe
   *  how the product is bought — e.g. a pallet nobody counts.) */
  countable: boolean;
  /** May a partial be entered here? A sealed pack is whole-only. */
  allowPartial: boolean;
}

/** A count expressed as "how many at each level", plus loose base units. */
export interface PackCount {
  /** level id -> how many whole ones. */
  byLevel: Record<number, number>;
  /** Base units not in any pack (4 loose buns). */
  loose: number;
}

export interface LevelProblem {
  levelId: number | null;
  message: string;
}

/**
 * A level worth less than the storage quantum converts a whole package to ZERO
 * (roundQty keeps six decimals), and a huge one overflows to Infinity, which
 * then also rounds to zero. Both turn real stock into none, so they are refused
 * outright rather than normalised.
 */
export const MIN_TO_BASE = 1e-6;
export const MAX_TO_BASE = 1e6;

const isPos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const inRange = (n: unknown): n is number => isPos(n) && n >= MIN_TO_BASE && n <= MAX_TO_BASE;
/** A row id has to be a real, stable identity — it keys the stored quantities. */
const isId = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

/**
 * The levels worth doing arithmetic with: valid ones, biggest first.
 * Sorting is what makes "biggest first" true for splitting, and the caller must
 * never depend on the order rows came out of the database in.
 */
export function usableLevels(levels: PackLevel[]): PackLevel[] {
  const seen = new Set<number>();
  return (levels || [])
    .filter((l) => {
      if (!l || !isId(l.id) || !inRange(l.toBase)) return false;
      // toBase === 1 IS the base unit, not packaging. Allowing it made
      // hasPackaging() true while the splitter skipped it — the two disagreed.
      if (l.toBase === 1) return false;
      // A repeated id would overwrite itself in the split and lose the rest of
      // the stock, so the FIRST wins and the clash is reported by validateLevels.
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    })
    .slice()
    .sort((a, b) => b.toBase - a.toBase || a.id - b.id);
}

/** The levels a staff member may actually type into, biggest first. */
export function countableLevels(levels: PackLevel[]): PackLevel[] {
  return usableLevels(levels).filter((l) => l.countable);
}

/** True when this product has any real packaging configured. */
export function hasPackaging(levels: PackLevel[]): boolean {
  return countableLevels(levels).length > 0;
}

/**
 * Base total from a per-level count.
 * Unknown level ids are IGNORED rather than guessed at: a level deleted after a
 * count was entered must not silently re-price that count at another level's rate.
 */
export function packTotal(count: PackCount, levels: PackLevel[]): number {
  // Iterate the KNOWN levels and look each id up, rather than walking whatever
  // keys the record happens to carry. Walking the record let "1", "01", "1e0"
  // and "0x1" all coerce to level 1, so the same level could be counted four
  // times over; and it let inherited keys in at all.
  const rec = (count?.byLevel || {}) as Record<string, unknown>;
  let total = 0;
  const loose = count?.loose;
  if (loose !== undefined && loose !== null) {
    if (typeof loose !== 'number' || !Number.isFinite(loose)) {
      throw new Error('PACK_BAD_QUANTITY: the loose amount is not a number');
    }
    total = loose;
  }
  for (const lvl of usableLevels(levels)) {
    const key = String(lvl.id);
    if (!Object.prototype.hasOwnProperty.call(rec, key)) continue;
    const qty = rec[key];
    if (qty === undefined || qty === null) continue;
    if (typeof qty !== 'number' || !Number.isFinite(qty)) {
      throw new Error(`PACK_BAD_QUANTITY: the count for “${lvl.name}” is not a number`);
    }
    total += qty * lvl.toBase;
  }
  // An overflow to Infinity would round to 0 — real stock reported as none.
  // Refuse rather than normalise a failure into a plausible quantity.
  if (!Number.isFinite(total)) throw new Error('PACK_OVERFLOW: that count is too large to store');
  return roundQty(total);
}

/**
 * Break a base total back into whole levels + a loose remainder, biggest first.
 *
 * This is a BEST FIT, not shape recovery: only the base total is stored, so the
 * original shape is genuinely unrecoverable. With 30s and 12s, three 12s (36)
 * shows as "1 x 30 + 6 loose" — a correct total, a different shape. Don't claim
 * to staff that it is what they typed.
 *
 * Only COUNTABLE levels are used: splitting into a pallet nobody counts would
 * show a number staff cannot verify on the shelf.
 *
 * The near-whole tolerance is the lesson from crate-units: a stored
 * 0.32999999999999996 at 0.03 each must read as eleven, not "ten and a bit".
 *
 * DISPLAY ONLY — never a data path. The loose remainder is rounded to 2dp for
 * human eyes, so on a fractional measure (0.333 kg) this does NOT round-trip
 * exactly. The STORED base total stays authoritative and must never be
 * recomputed from a split; feeding this back through packTotal would quietly
 * shave the third decimal off stock every time a row was re-saved.
 */
export function splitToLevels(total: number, levels: PackLevel[]): PackCount {
  const t = Number.isFinite(total) ? total : 0;
  const usable = countableLevels(levels);
  const byLevel: Record<number, number> = {};
  if (usable.length === 0) return { byLevel, loose: round2(t) };

  let rest = t;
  for (const lvl of usable) {
    // Skip ONLY the base unit itself. A pack can legitimately be worth LESS
    // than one base unit — a bunch of herbs is 0.03 kg — and `<= 1` threw those
    // away entirely, so a weight product had no packaging at all.
    if (lvl.toBase === 1) continue;
    const raw = rest / lvl.toBase;
    const nearest = Math.round(raw);
    const whole = Math.abs(raw - nearest) < 1e-9 * Math.max(1, Math.abs(raw))
      ? nearest
      : Math.floor(raw);
    if (whole > 0) {
      byLevel[lvl.id] = whole;
      rest = roundQty(rest - whole * lvl.toBase);
    }
  }
  return { byLevel, loose: round2(rest) };
}

/**
 * "1 box = 3 packs = 30 pieces" — the chain in the words staff use, derived from
 * each level's base value so it can never disagree with the arithmetic.
 */
export function describeChain(levels: PackLevel[], baseWord: string): string {
  const usable = usableLevels(levels);
  if (usable.length === 0) return '';
  const parts: string[] = [];
  usable.forEach((lvl, i) => {
    const next = usable[i + 1];
    const perNext = next && next.toBase > 0 ? lvl.toBase / next.toBase : null;
    parts.push(
      perNext != null && Number.isInteger(perNext)
        ? `1 ${lvl.name} = ${perNext} ${pluralizePack(next.name, perNext)}`
        : `1 ${lvl.name} = ${round2(lvl.toBase)} ${baseWord || 'units'}`,
    );
  });
  // The loop already ends the chain in base units: the smallest level has no
  // `next`, so it prints "1 pack = 10 pieces". Appending that again printed the
  // last level twice.
  return parts.join(' · ');
}

/**
 * Problems that make a chain untrustworthy. Fail LOUD here rather than let a bad
 * conversion reach the ledger, where it silently misprices stock forever.
 */
export function validateLevels(levels: PackLevel[]): LevelProblem[] {
  const problems: LevelProblem[] = [];
  const seenId = new Set<number>();
  const seenBase = new Map<number, PackLevel>();
  const seenName = new Set<string>();
  for (const l of levels || []) {
    if (!l) continue;
    // A duplicate id is the dangerous one: the split writes both into the same
    // slot, so part of the stock silently disappears (30 + 12 came back as 12).
    if (!isId(l.id)) {
      problems.push({ levelId: null, message: `“${l.name || 'level'}” has no valid id.` });
    } else if (seenId.has(l.id)) {
      problems.push({ levelId: l.id, message: `Two levels share the same id (${l.id}) — one of them would be lost.` });
    } else {
      seenId.add(l.id);
    }
    if (!isPos(l.toBase)) {
      problems.push({ levelId: l.id ?? null, message: `“${l.name || 'level'}” must be worth more than zero.` });
      continue;
    }
    if (l.toBase === 1) {
      problems.push({ levelId: l.id, message: `“${l.name}” is worth one base unit — that is the base unit itself, not packaging.` });
      continue;
    }
    if (l.toBase < MIN_TO_BASE) {
      problems.push({ levelId: l.id, message: `“${l.name}” is too small to store — one of them would count as nothing.` });
      continue;
    }
    if (l.toBase > MAX_TO_BASE) {
      problems.push({ levelId: l.id, message: `“${l.name}” is larger than this can safely store.` });
      continue;
    }
    const clash = seenBase.get(l.toBase);
    if (clash) {
      problems.push({ levelId: l.id, message: `“${l.name}” and “${clash.name}” are both ${round2(l.toBase)} — one of them is redundant.` });
    } else {
      seenBase.set(l.toBase, l);
    }
    const key = (l.name || '').trim().toLowerCase();
    if (key && seenName.has(key)) {
      problems.push({ levelId: l.id, message: `There are two levels called “${l.name}”.` });
    }
    if (key) seenName.add(key);
  }
  return problems;
}
