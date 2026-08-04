/**
 * The house code a product carries when it has no supplier barcode.
 *
 * Mirrors `location-code.ts`, and the two are deliberately unmistakable for one
 * another: a shelf label prints BOTH — the product's code as bars and the
 * shelf's as a QR — so a scan that catches the wrong one must still be
 * classified correctly rather than reaching the product lookup and offering to
 * create a phantom product. (Ethan asked exactly this, 2026-08-04.)
 *
 * `KRW-<odoo product id>`: unique by construction, so two managers running the
 * bulk assignment at once cannot collide; stable when a product is renamed; and
 * plain uppercase + digits + hyphen, which any hardware scanner can type.
 *
 * NOT a fake EAN-13 — Krawings owns no GS1 prefix and these labels never leave
 * the building. Verified against staging Odoo: it stores, reads back and finds
 * a letter-prefixed code (the default nomenclature is non-GS1).
 */
const PREFIX = 'KRW-';

export function houseCode(productId: number): string {
  return `${PREFIX}${productId}`;
}

/** Parse a scanned code back to a product id, or null if it isn't one of ours. */
export function parseHouseCode(code: string): number | null {
  const m = code.trim().match(/^KRW-(\d+)$/i);
  return m ? parseInt(m[1], 10) : null;
}

/** True when this product still needs a code before its shelf label can scan. */
export function needsHouseCode(barcode: string | false | null | undefined): boolean {
  return !barcode || String(barcode).trim() === '';
}
