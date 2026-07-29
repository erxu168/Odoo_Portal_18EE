/**
 * ONE definition of "the product catalog" — the Odoo domain that decides which
 * products the Products module manages.
 *
 * This exists because the dashboard counts and the catalog list are two screens
 * asking the same question. If each built its own domain they would drift, and
 * a dashboard tile reading "600" above a list showing 583 is a bug the user
 * reports as "the numbers are wrong" long after the cause is forgotten.
 *
 * Scope decisions, and why:
 *  - `type = 'consu'` — Odoo 18 calls physical things "Goods". Services and
 *    combos are not stock and are not managed here.
 *  - `available_in_pos = false` — till items are menu products maintained in
 *    POS, not raw stock. The catalog is the things you buy, hold and count.
 *  - active — archived products are a deliberate filter, never the default.
 */

/** The base domain every catalog screen starts from. */
export function catalogDomain(opts: { includePos?: boolean; activeOnly?: boolean } = {}): unknown[] {
  const { includePos = false, activeOnly = true } = opts;
  const domain: unknown[] = [['type', '=', 'consu']];
  if (!includePos) domain.push(['available_in_pos', '=', false]);
  if (activeOnly) domain.push(['active', '=', true]);
  return domain;
}

/**
 * Fields every catalog screen reads. Kept together so adding one — as
 * `is_storable` was, for the "not counted in stock" warning — reaches the list,
 * the dashboard and any future screen at once instead of one at a time.
 */
export const CATALOG_FIELDS = [
  'id', 'name', 'default_code', 'product_tmpl_id', 'categ_id', 'uom_id', 'type',
  'barcode', 'active', 'available_in_pos', 'company_id', 'description',
  // Odoo 18 splits "is it a physical good?" (type) from "do we track its
  // quantity?" (is_storable, default FALSE). A product with this off holds no
  // stock figure, so a count of it can never be written back.
  'is_storable',
] as const;

/**
 * The subset a screen needs when it is COUNTING products rather than showing
 * them. Same query, no HTML descriptions or supplier hydration — the Products
 * dashboard reads several hundred rows just to print four numbers on a tablet.
 */
export const SLIM_CATALOG_FIELDS = ['id', 'name', 'active', 'is_storable'] as const;
