/**
 * The fields every product this portal creates must carry, and why.
 *
 * There were three creators before this file — the catalog, Purchase, and the
 * scan-an-unknown-barcode flow — and they disagreed. All three set `type` and
 * none set `is_storable`, so every product the portal has ever made arrived
 * holding no stock figure and could never take a count. Purchase additionally
 * wrote the one price it was given into BOTH the cost and the selling price.
 *
 * Keeping the shape in one place is the point: a new field belongs to all of
 * them or to none, and a difference between them should have to be written down
 * as a deliberate override rather than happening because someone edited one file.
 */

export interface NewProductFields {
  name: string;
  uomId: number;
  categId: number;
  barcode?: string;
  defaultCode?: string;
  /** Odoo 18 "Track Inventory". See the note below — default TRUE here. */
  isStorable?: boolean;
  /** What YOU pay. Odoo's standard_price. */
  cost?: number | null;
  /** What you CHARGE. Odoo's list_price. Different money; never the same input. */
  salesPrice?: number | null;
  /** Created inactive, for a flow that reviews it before it goes live. */
  inactive?: boolean;
}

/**
 * Build the vals object for `product.product.create`.
 *
 * `is_storable` defaults to TRUE, which is the opposite of Odoo's own default,
 * deliberately. Odoo asks "is this a physical good?" (`type`) and "do we track
 * how much of it we hold?" (`is_storable`) as separate questions and answers no
 * to the second. Anything this portal creates is something a restaurant holds on
 * a shelf, so no is the wrong answer every time — and it is the reason 133
 * existing products cannot be counted.
 */
export function buildProductVals(f: NewProductFields): Record<string, unknown> {
  const vals: Record<string, unknown> = {
    name: f.name,
    type: 'consu',                                   // Odoo 18: "Goods"
    is_storable: f.isStorable !== false,
    tracking: 'none',                                // lot/serial is a separate decision, made in Odoo
    categ_id: f.categId,
    uom_id: f.uomId,
    // Buying unit follows the stock unit. Odoo requires the two to share a unit
    // family, and equal is the only value guaranteed valid at create time; a
    // different buying unit is set later, on the product's own page.
    uom_po_id: f.uomId,
  };
  if (f.barcode) vals.barcode = f.barcode;
  if (f.defaultCode) vals.default_code = f.defaultCode;
  // The two prices are two different facts and must be set from two different
  // inputs. Purchase used to put the supplier's price into both, which quietly
  // told the till to sell soy sauce for what the case cost.
  if (f.cost != null) vals.standard_price = f.cost;
  if (f.salesPrice != null) vals.list_price = f.salesPrice;
  if (f.inactive) vals.active = false;
  // purchase_ok / sale_ok / company_id are left to Odoo's defaults on purpose:
  // shared across restaurants and orderable, which is what every product in this
  // catalog already is.
  return vals;
}

/**
 * The fields to write when a reviewed draft goes live.
 *
 * Separate from create because a draft already exists — but it must pick up the
 * same stock-tracking answer, or approving a scanned product produces exactly
 * the uncountable record this file exists to prevent.
 */
export function buildDraftApprovalVals(f: {
  name: string; uomId: number; categId: number; cost?: number | null;
}): Record<string, unknown> {
  const vals: Record<string, unknown> = {
    name: f.name,
    categ_id: f.categId,
    uom_id: f.uomId,
    uom_po_id: f.uomId,
    is_storable: true,      // it was scanned off a shelf; of course it is counted
    active: true,
  };
  if (f.cost != null) vals.standard_price = f.cost;
  return vals;
}
