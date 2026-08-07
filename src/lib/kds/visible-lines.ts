/**
 * Which POS order lines the kitchen is allowed to see.
 *
 * Pure and dependency-free on purpose: the KDS route resolves the hidden product
 * IDs from Odoo (src/lib/kds-hidden-products.ts, which pulls in next/headers via
 * the Odoo client), while THIS decision stays importable from a plain unit test.
 */

/** The shape we need off a pos.order.line: Odoo sends product_id as [id, name]. */
export interface LineWithProduct {
  product_id?: unknown;
}

/** Odoo many2one -> id. Accepts [id, name], a bare id, or nothing. */
export function productIdOf(raw: unknown): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Drop lines whose product sits in a category hidden from the kitchen
 * (self-service drinks). An EMPTY hidden set keeps everything — that is also
 * what a failed Odoo lookup produces, so the kitchen never loses food to an
 * error. A line with no resolvable product ID is kept for the same reason.
 */
export function visibleLines<T extends LineWithProduct>(lines: T[], hidden: Set<number>): T[] {
  if (hidden.size === 0) return lines;
  return lines.filter(l => {
    const pid = productIdOf(l.product_id);
    return pid === null || !hidden.has(pid);
  });
}
