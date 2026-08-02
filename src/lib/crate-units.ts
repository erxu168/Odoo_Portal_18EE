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
  // Rounded, because this total is STORED. 11 bunches of 0.03 kg is 0.33, but
  // binary floating point makes it 0.32999999999999996, and that number then
  // divides back into ten bunches and a remainder. Six decimals is far finer
  // than any kitchen scale and leaves no room for the noise.
  return roundQty(hasCrate(unitsPerCrate) ? c * unitsPerCrate + l : l);
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
  // Floor, but treat "a hair under a whole one" as a whole one. Without this a
  // stored 0.32999999999999996 at 0.03 each reads as 10 bunches plus a loose
  // one — the counter taps eleven times and the row says ten.
  const raw = t / unitsPerCrate;
  const nearest = Math.round(raw);
  const crates = Math.abs(raw - nearest) < 1e-9 * Math.max(1, Math.abs(raw))
    ? nearest
    : Math.floor(raw);
  const loose = round2(t - crates * unitsPerCrate);
  return { crates, loose };
}

/** Pluralize a pack label: "crate"→"crates", "bunch"→"bunches", "box"→"boxes". */
export function pluralizePack(label: string, n: number): string {
  const l = (label || 'pack').trim();
  if (n === 1) return l;
  // A single trailing s means the word is already plural — people type "units"
  // or "pieces" as readily as "unit", and "unitses" is not a word. Double-s is
  // a real singular: glass -> glasses.
  if (/ss$/i.test(l)) return `${l}es`;
  if (/s$/i.test(l)) return l;
  if (/(x|z|ch|sh)$/i.test(l)) return `${l}es`;
  if (/[^aeiou]y$/i.test(l)) return `${l.slice(0, -1)}ies`;
  // potato -> potatoes, tomato -> tomatoes (kitchen words that take -es).
  if (/[^aeiou]o$/i.test(l)) return `${l}es`;
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

/**
 * The two words a person actually says about this product: what a whole one is
 * called ("crate", "bunch") and what a single one is called ("bottle").
 *
 * This exists because the same fallback was written out by hand in eight places
 * and two of them disagreed — a product read "1 pack = 24" on the receiving
 * screen and "1 crate = 24" in the count sheet. One product, two names.
 *
 * The loose word falls back to the Odoo unit, which is why a bottle of Ting
 * still reads "Units" until a manager types the real word.
 */
export interface UnitWords {
  /** A whole one: "crate", "bunch", "box". */
  pack: string;
  /** A single one: "bottle", "piece" — or the raw Odoo unit if nobody said. */
  loose: string;
  /** Weight/volume base: there is no such thing as a loose gram on a shelf. */
  measure: boolean;
  /** True when `loose` is a word a person typed, not the raw Odoo unit. */
  looseNamed: boolean;
  /**
   * The loose word for n of them. A real word gets pluralised; a raw unit code
   * never does — "Units" is not a noun and pluralising it gives "Unitses", and
   * "kg" gives "kgs". Ask this instead of calling pluralizePack on `loose`.
   */
  looseFor(n: number): string;
}
export function unitWords(
  uom: string | null | undefined,
  packLabel?: string | null,
  looseLabel?: string | null,
): UnitWords {
  const unit = (uom || '').trim() || 'Units';
  const measure = baseIsMeasure(unit);
  const named = (looseLabel || '').trim();
  const loose = named || unit;
  return {
    pack: (packLabel || '').trim() || (measure ? 'piece' : 'crate'),
    loose,
    measure,
    looseNamed: !!named,
    looseFor: (n: number) => (named ? pluralizePack(named, n) : unit),
  };
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

/**
 * Container-level counting: a marked quarter of the open container feeds the
 * EXISTING loose quantity, and the review glyph derives the quarter back.
 * These two are each other's inverses BY CONSTRUCTION — both sides round with
 * roundQty, so fractionToLoose → quarterFromLoose always round-trips.
 */
export const LEVEL_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;
export type LevelFraction = (typeof LEVEL_FRACTIONS)[number];

/** "¾ of a 10 L bucket" → 7.5 (base units, stored as the loose quantity). */
export function looseFromFraction(fraction: number, unitsPerCrate: number): number {
  return roundQty(fraction * unitsPerCrate);
}

/**
 * The quarter a stored loose amount represents — or null when it isn't a clean
 * quarter of this pack size (typed via numpad, or the pack size changed since).
 * Null means: show the words, skip the glyph, open the picker unset.
 */
export function quarterFromLoose(loose: number, unitsPerCrate: number | null | undefined): LevelFraction | null {
  if (!hasCrate(unitsPerCrate) || !Number.isFinite(loose) || loose < 0) return null;
  const q = Math.round((loose / unitsPerCrate) * 4) / 4;
  if (q < 0 || q > 1) return null;
  if (!LEVEL_FRACTIONS.includes(q as LevelFraction)) return null;
  return roundQty(q * unitsPerCrate) === roundQty(loose) ? (q as LevelFraction) : null;
}

/**
 * Kill binary-floating-point dust without touching a quantity anyone meant.
 * Exported because the multi-level packaging engine (src/lib/packaging.ts) must
 * round EXACTLY the same way — two roundings would disagree at the sixth decimal
 * and a total would stop reading back as the count that produced it.
 */
export function roundQty(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Number.isInteger(n) ? n : Math.round(n * 1e6) / 1e6;
}

/** Display rounding (2dp). Same reason as roundQty: one definition, not two. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Number.isInteger(n) ? n : Math.round(n * 100) / 100;
}

/**
 * Par <-> what a person types. Par is STORED in base units so the ordering
 * maths never cares how a product is counted — but a measure-based product
 * counted in packs ("1 can = 0.28 kg") is asked for and shown in PACKS, the
 * unit the person deciding "should we order?" actually thinks in. Factor 1
 * means no conversion: the base unit already IS what staff count.
 */
export function parEntryFactor(uom: string, unitsPerCrate: number | null | undefined): number {
  return baseIsMeasure(uom) && hasCrate(unitsPerCrate) ? unitsPerCrate : 1;
}

const safeFactor = (factor: number): number =>
  Number.isFinite(factor) && factor > 0 ? factor : 1;

/** A stored base-unit par, in the entry unit (2dp — this is for reading). */
export function parToEntry(base: number, factor: number): number {
  return round2(base / safeFactor(factor));
}

/** A typed entry-unit par, in base units for storage (full precision). */
export function parToBase(entry: number, factor: number): number {
  return roundQty(entry * safeFactor(factor));
}
