/**
 * Crate <-> base-unit maths for inventory counting.
 *
 * The base unit is whatever Odoo stores on the product (its uom_id — usually a
 * single bottle/can/piece). A "crate" (Kasten) is simply `units_per_crate`
 * base units. Odoo is ONLY ever written the base total — crates never reach it.
 * These helpers convert between "X crates + Y loose" and the base total, and
 * are the single source of truth for that arithmetic across the count entry,
 * review, and product-settings screens.
 */

export interface CrateSplit {
  crates: number;
  loose: number;
}

/** True when a product is set up to be counted in crates. */
export function hasCrate(unitsPerCrate: number | null | undefined): unitsPerCrate is number {
  return typeof unitsPerCrate === 'number' && Number.isFinite(unitsPerCrate) && unitsPerCrate > 0;
}

/**
 * Base total from a crate/loose split.
 * total = crates * unitsPerCrate + loose. If there's no crate size, the crate
 * count is ignored and only the loose figure counts.
 */
export function crateTotal(
  crates: number,
  loose: number,
  unitsPerCrate: number | null | undefined,
): number {
  const c = Number.isFinite(crates) ? crates : 0;
  const l = Number.isFinite(loose) ? loose : 0;
  return hasCrate(unitsPerCrate) ? c * unitsPerCrate + l : l;
}

/**
 * Break a base total into whole crates + loose remainder (for display).
 * With no crate size, everything is "loose".
 */
export function splitFromTotal(
  total: number,
  unitsPerCrate: number | null | undefined,
): CrateSplit {
  const t = Number.isFinite(total) ? total : 0;
  if (!hasCrate(unitsPerCrate)) return { crates: 0, loose: t };
  const crates = Math.floor(t / unitsPerCrate);
  const loose = round2(t - crates * unitsPerCrate);
  return { crates, loose };
}

/** "3 crates + 7 Units" — or "79 Units" when there's no crate part. */
export function formatSplit(crates: number, loose: number, unit: string): string {
  const u = unit || 'Units';
  if (crates <= 0) return `${round2(loose)} ${u}`;
  const crateWord = crates === 1 ? 'crate' : 'crates';
  return `${crates} ${crateWord} + ${round2(loose)} ${u}`;
}

/** "79 Units" — the base-unit-only display. */
export function formatBase(total: number, unit: string): string {
  return `${round2(total)} ${unit || 'Units'}`;
}

/**
 * Guess a crate size from a product name, e.g.
 *   "Coca-Cola Mw 24x0,33"  -> 24
 *   "Rothaus Pils Mw 20x0.5L" -> 20
 *   "Kasten Beer 20 er"      -> 20
 * Returns null when nothing plausible is found. Used only to pre-fill a
 * suggestion a manager confirms — never written silently.
 */
export function suggestCrateSizeFromName(name: string): number | null {
  if (!name) return null;
  // "24x0,33", "20 x 0.5", "12X1,00" — the count is the number before the x.
  const nx = name.match(/(\d{1,3})\s*[xX]\s*\d/);
  if (nx) {
    const n = parseInt(nx[1], 10);
    if (n > 1 && n <= 200) return n;
  }
  // "20er" / "20 er"
  const er = name.match(/(\d{1,3})\s*er\b/i);
  if (er) {
    const n = parseInt(er[1], 10);
    if (n > 1 && n <= 200) return n;
  }
  return null;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Number.isInteger(n) ? n : Math.round(n * 100) / 100;
}
