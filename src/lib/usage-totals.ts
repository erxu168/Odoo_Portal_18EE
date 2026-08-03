import {
  getSessionEntries, getSessionItems, getSessionLocationStatuses, getSessionLocations,
} from '@/lib/inventory-db';

/**
 * What ONE count says a product's quantity was — and, just as importantly, when
 * it says nothing at all.
 *
 * This is the core of the usage report (`used = start + received − binned − end`).
 * It lives here rather than inside the route so the tests exercise the REAL rule
 * instead of a copy of it that can drift.
 *
 * A product's figure is the sum of its spots, and there are TWO ways that sum
 * would be a lie rather than a number. Both drop the product out of `qty`
 * entirely, to be reported as a stated gap:
 *
 *  1. "Couldn't find it" ANYWHERE — the quantity is unknown, which is why
 *     approval leaves its stock alone. Summing the spots where it WAS found
 *     turns "at least 5" into a closing figure of 5 and invents consumption.
 *
 *  2. A SPOT THE PRODUCT LIVES AT WAS SKIPPED. Exactly the same shape of lie: a
 *     product kept in the walk-in AND a drawer, with the drawer skipped, used to
 *     return just the walk-in's figure marked complete — so the end count read
 *     LOW and "used" read HIGH by whatever sat in the drawer. Silently, on every
 *     report. A skip is a person saying "I didn't look here".
 *
 * Out-of-stock is deliberately NOT a gap: "I looked, there is none" is a real
 * zero and still counts. (Ethan, 2026-08-03.)
 */
export interface SessionTotals {
  /** product id → base-unit total, ONLY for products this count really answered. */
  qty: Record<number, number>;
  /** Answered "couldn't find it" — quantity unknown. */
  unknown: Set<number>;
  /** Lives at a spot nobody looked at — quantity unknown for a different reason. */
  skipped: Set<number>;
  /** The skipped shelves, named, so the report can say WHERE to go back to. */
  skippedSpotNames: string[];
  /**
   * A skipped shelf this count's frozen lines CANNOT explain — so we cannot tell
   * which products it covered, and no total from this count can be trusted.
   * Only legacy counts can hit this (see the fail-closed note below).
   */
  unverifiableSkip: boolean;
}

export function sessionTotals(sessionId: number): SessionTotals {
  const qty: Record<number, number> = {};
  const unknown = new Set<number>();
  const counted = new Set<string>();
  for (const e of getSessionEntries(sessionId)) {
    if ((e as unknown as { not_found?: unknown }).not_found) unknown.add(e.product_id);
    qty[e.product_id] = (qty[e.product_id] || 0) + (Number(e.counted_qty) || 0);
    counted.add(`${e.product_id}:${e.count_location_id}`);
  }

  const skippedSpots = new Set(
    getSessionLocationStatuses(sessionId)
      .filter((s) => s.status === 'skipped')
      .map((s) => s.count_location_id),
  );
  const skipped = new Set<number>();
  let unverifiableSkip = false;
  const skippedSpotNames: string[] = [];

  if (skippedSpots.size > 0) {
    const items = getSessionItems(sessionId);
    const linedSpots = new Set(items.map((i) => i.count_location_id));
    // Read from the count's FROZEN lines, never from live placements: a spot
    // added to a product after the count must not retro-invalidate it.
    for (const it of items) {
      if (!skippedSpots.has(it.count_location_id)) continue;
      // Counting a spot clears its skip (see api/inventory/counts), but check
      // the entries anyway — a stale status must never discard a real number.
      if (counted.has(`${it.odoo_product_id}:${it.count_location_id}`)) continue;
      skipped.add(it.odoo_product_id);
    }
    // FAIL-CLOSED, but ONLY for a count whose lines cannot describe shelves at
    // all: a LEGACY count (predating snapshots, frozen flat at the catch-all
    // spot 0 by the one-time migration, or with no frozen lines whatever) can
    // carry a skip at a REAL shelf while not one of its lines mentions a real
    // shelf. Any product could have been on it, so every total from that count
    // may be partial — exactly the bug this file exists to stop, so the whole
    // count declares itself unusable for usage rather than hand back the
    // partial sums. (Codex, 2026-08-03.)
    //
    // In a MODERN count the frozen lines are complete, so a skip at a shelf no
    // line mentions means that shelf simply held nothing on this list — utterly
    // harmless, and must NOT invalidate anything. Failing closed on that was my
    // first attempt and a test caught it.
    const describesRealSpots = items.some((i) => i.count_location_id !== 0);
    unverifiableSkip = !describesRealSpots && Array.from(skippedSpots).some((id) => id !== 0);
    if (unverifiableSkip) Object.keys(qty).map(Number).forEach((pid) => skipped.add(pid));

    const named = new Map(getSessionLocations(sessionId).map((l) => [l.count_location_id, l.name]));
    Array.from(skippedSpots).forEach((id) => {
      const n = named.get(id);
      if (n) skippedSpotNames.push(n);
    });
  }

  unknown.forEach((pid) => { delete qty[pid]; });
  skipped.forEach((pid) => { delete qty[pid]; });
  return { qty, unknown, skipped, skippedSpotNames, unverifiableSkip };
}
