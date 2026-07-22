/**
 * Universal Record Drill-Down — the single registry behind the app-wide
 * standard that every displayed business record can open its canonical page.
 *
 * Add a new entity here (route + the capability required to EDIT it) and every
 * `RecordLink` reference to it across the app becomes a working drill-down.
 * Viewing a record is a right of any authenticated user; editing is gated by
 * the capability below (the canonical page renders read-only otherwise).
 */
export type RecordType = 'product' | 'location';

/** The canonical Form-View URL for a record — its permanent address. */
export function recordHref(type: RecordType, id: number | string): string {
  switch (type) {
    case 'product': return `/products/${id}`;
    case 'location': return `/inventory/location/${id}`;
    default: return '/';
  }
}

/** Capability that grants EDIT on this record type (view needs none). */
export const RECORD_EDIT_CAP: Record<RecordType, string> = {
  product: 'inventory.productsettings.manage',
  location: 'inventory.location.manage',
};

/** Human label for the record type — used in aria/tooltips. */
export const RECORD_NOUN: Record<RecordType, string> = {
  product: 'product',
  location: 'location',
};
