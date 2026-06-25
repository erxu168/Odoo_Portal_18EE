/**
 * Note helpers for the KDS.
 * Keeps the "is this an allergy?" rule in one place so every view flags it the same way.
 */

// Words that mark a free-text note as an allergy / intolerance, so the screen can shout about it.
const ALLERGY_PATTERN = /allerg|intoleran|coeliac|celiac|anaphyla|gluten[\s-]?free|nut[\s-]?free/i;

/** True when a note looks like an allergy / intolerance warning. */
export function isAllergyNote(note?: string | null): boolean {
  return !!note && ALLERGY_PATTERN.test(note);
}
