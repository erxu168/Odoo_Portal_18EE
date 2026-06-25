/**
 * Note helpers for the KDS.
 *
 * Cooks need cooking instructions ("no onions", "extra spicy", "gluten free"),
 * but NOT allergy/additive declarations ("allergy: nuts", "contains E330").
 * The kitchen does not handle allergen/additive info — that's a front-of-house /
 * menu-labelling concern — so the screen hides those notes.
 */

// Declaration-style allergen / additive info the kitchen should not see.
const HIDE_PATTERN = /allerg|intoleran|enthält|\bcontains\b|\badditive|zusatzstoff|konservierungsstoff|farbstoff|antioxidationsmittel|geschmacksverstärker|süßungsmittel|phosphat|geschwärzt|geschwefelt|nitritpökel|\bE\s?\d{3}\b/i;

/** True when a note is an allergen / additive declaration that cooks should not see. */
export function isAllergenOrAdditiveNote(note?: string | null): boolean {
  return !!note && HIDE_PATTERN.test(note);
}
