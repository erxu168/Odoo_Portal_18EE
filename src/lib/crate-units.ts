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

/** Pluralize a pack label: "crate"→"crates", "bunch"→"bunches", "box"→"boxes". */
export function pluralizePack(label: string, n: number): string {
  const l = (label || 'pack').trim();
  if (n === 1) return l;
  if (/(s|x|z|ch|sh)$/i.test(l)) return `${l}es`;
  if (/[^aeiou]y$/i.test(l)) return `${l.slice(0, -1)}ies`;
  return `${l}s`;
}

/**
 * "3 crates + 7 Units" (count base) / "12 pieces" (weight base, no loose) /
 * "79 Units" when there's no pack part.
 */
export function formatSplit(crates: number, loose: number, unit: string, packLabel = 'pack'): string {
  const u = unit || 'Units';
  if (crates <= 0) return `${round2(loose)} ${u}`;
  const word = pluralizePack(packLabel, crates);
  if (!loose) return `${crates} ${word}`;
  return `${crates} ${word} + ${round2(loose)} ${u}`;
}

/**
 * True when the base UoM is a weight/volume measure (kg, g, L…) rather than a
 * discrete count. Weight-based products are counted by piece/bunch only — no
 * "loose grams" field, because staff can't weigh a partial on the floor.
 */
const MEASURE_UOMS = new Set([
  'kg', 'g', 'mg', 'kilogram', 'kilogramm', 'gram', 'gramm', 'gramme',
  'l', 'ml', 'cl', 'dl', 'liter', 'litre', 'lt',
  'oz', 'lb',
]);
export function baseIsMeasure(uom: string): boolean {
  return MEASURE_UOMS.has((uom || '').trim().toLowerCase());
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
