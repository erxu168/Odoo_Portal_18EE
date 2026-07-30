/**
 * What a product COSTS TO BUY.
 *
 * The order guide showed Odoo's `list_price` — the price you SELL at. Almost no
 * product here has one set, so Odoo's default of 1.00 stood in, and the guide
 * read €1.00 for essentially everything. Meanwhile the real numbers were sitting
 * one model away: 515 of 601 catalog products have a supplier price on
 * product.supplierinfo (7.30, 6.95, 33.75…) and only 8 have a cost.
 *
 * Three sources, in the order they should be trusted:
 *
 *   supplier — product.supplierinfo.price for THIS supplier. The actual number on
 *              their price list, and the only one that is truly "what we pay
 *              them". An order guide belongs to one supplier, so this is
 *              answerable.
 *   cost     — product.standard_price. What the product is valued at. A decent
 *              estimate when the supplier has not been priced, and honest as long
 *              as it is labelled as an estimate rather than shown as their price.
 *   none     — no basis for a number. Zero, and SAID to be unknown, because a
 *              confident 0.00 on an order is worse than a blank.
 *
 * list_price is never used. It answers a different question.
 */

export type PriceSource = 'supplier' | 'cost' | 'none';

export interface ResolvedPrice {
  price: number;
  source: PriceSource;
  /** The supplier the price came from, when it came from one. */
  supplier_name?: string;
}

export interface SupplierPriceRow {
  product_id: number | false;
  product_tmpl_id: number | false;
  partner_id: [number, string] | false;
  price: number;
  min_qty?: number;
}

/**
 * Index supplier prices for lookup by variant id and by template id.
 *
 * Both are needed: a product.supplierinfo row may be attached to one VARIANT
 * (product_id) or to the whole TEMPLATE (product_id false, product_tmpl_id set),
 * and the template case is by far the commoner. Looking at only one of them
 * misses most of the prices in this database.
 */
export function indexSupplierPrices(rows: SupplierPriceRow[], partnerId?: number) {
  const byVariant = new Map<number, SupplierPriceRow>();
  const byTemplate = new Map<number, SupplierPriceRow>();
  for (const r of rows) {
    if (partnerId != null) {
      const p = Array.isArray(r.partner_id) ? r.partner_id[0] : null;
      if (p !== partnerId) continue;                 // another supplier's price
    }
    if (!(r.price > 0)) continue;                    // 0 is "not priced", not free
    const v = typeof r.product_id === 'number' ? r.product_id
      : Array.isArray(r.product_id) ? (r.product_id as unknown as [number, string])[0] : null;
    const t = typeof r.product_tmpl_id === 'number' ? r.product_tmpl_id
      : Array.isArray(r.product_tmpl_id) ? (r.product_tmpl_id as unknown as [number, string])[0] : null;
    // Keep the CHEAPEST when a supplier has several rows for one product — those
    // are usually quantity breaks, and the guide shows a single unit price.
    if (v != null && (!byVariant.has(v) || byVariant.get(v)!.price > r.price)) byVariant.set(v, r);
    if (t != null && (!byTemplate.has(t) || byTemplate.get(t)!.price > r.price)) byTemplate.set(t, r);
  }
  return { byVariant, byTemplate };
}

/** Resolve one product's buying price from the indexed supplier rows. */
export function resolveBuyPrice(
  product: { id: number; product_tmpl_id?: [number, string] | number | false; standard_price?: number },
  index: ReturnType<typeof indexSupplierPrices>,
): ResolvedPrice {
  const tmplId = Array.isArray(product.product_tmpl_id) ? product.product_tmpl_id[0]
    : typeof product.product_tmpl_id === 'number' ? product.product_tmpl_id : null;

  const hit = index.byVariant.get(product.id)
    ?? (tmplId != null ? index.byTemplate.get(tmplId) : undefined);
  if (hit) {
    return {
      price: hit.price,
      source: 'supplier',
      supplier_name: Array.isArray(hit.partner_id) ? hit.partner_id[1] : undefined,
    };
  }
  if (product.standard_price && product.standard_price > 0) {
    return { price: product.standard_price, source: 'cost' };
  }
  return { price: 0, source: 'none' };
}

/** How to describe where a price came from, on screen. */
export function priceSourceLabel(source: PriceSource, supplierName?: string): string {
  switch (source) {
    case 'supplier': return supplierName ? `${supplierName}’s price` : 'supplier price';
    case 'cost': return 'our cost — no supplier price yet';
    default: return 'no price yet';
  }
}
