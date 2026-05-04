import type { OdooClient } from './odoo';

const ACTIVE_MOVE_STATES = new Set(['confirmed', 'partially_available', 'assigned']);

interface RawMove {
  id: number;
  product_id: [number, string];
  product_uom: [number, string];
  quantity: number;
  state: string;
  move_line_ids: number[];
  location_id: [number, string];
  location_dest_id: [number, string];
}

/**
 * Ensure every tracked component on a Manufacturing Order has a lot assigned
 * to its consumed quantity, so `button_mark_done` doesn't error with
 * "You need to supply Lot/Serial Number for products and 'consume' them".
 *
 * Strategy: find-or-create a stock.lot named after the MO for each tracked
 * component product, then write `lot_id` onto the move's existing
 * stock.move.line records (or create one if none exist).
 */
export async function ensureTrackedComponentLots(
  odoo: OdooClient,
  moId: number,
): Promise<void> {
  const moRows = await odoo.read('mrp.production', [moId], [
    'name', 'company_id', 'move_raw_ids',
  ]);
  if (!moRows.length) return;
  const mo = moRows[0];
  const rawIds: number[] = mo.move_raw_ids || [];
  if (!rawIds.length) return;

  const moves: RawMove[] = await odoo.searchRead('stock.move',
    [['id', 'in', rawIds]],
    ['product_id', 'product_uom', 'quantity', 'state',
     'move_line_ids', 'location_id', 'location_dest_id'],
  );

  const consumable = moves.filter(m =>
    ACTIVE_MOVE_STATES.has(m.state) && (m.quantity || 0) > 0,
  );
  if (!consumable.length) return;

  const productIds = Array.from(new Set(consumable.map(m => m.product_id[0])));
  const products = await odoo.read('product.product', productIds, ['tracking']);
  const trackingByProduct = new Map<number, string>(
    products.map((p: any) => [p.id, p.tracking || 'none']),
  );

  const lotName: string = mo.name;
  const companyId: number | false = mo.company_id?.[0] || false;

  for (const move of consumable) {
    const productId = move.product_id[0];
    const tracking = trackingByProduct.get(productId) || 'none';
    if (tracking === 'none') continue;

    const existing = await odoo.searchRead('stock.lot',
      [['name', '=', lotName], ['product_id', '=', productId]],
      ['id'], { limit: 1 });

    let lotId: number;
    if (existing.length > 0) {
      lotId = existing[0].id;
    } else {
      const lotVals: Record<string, any> = {
        name: lotName,
        product_id: productId,
      };
      if (companyId) lotVals.company_id = companyId;
      lotId = await odoo.create('stock.lot', lotVals);
    }

    if (move.move_line_ids?.length) {
      await odoo.write('stock.move.line', move.move_line_ids, { lot_id: lotId });
    } else {
      await odoo.create('stock.move.line', {
        move_id: move.id,
        product_id: productId,
        product_uom_id: move.product_uom[0],
        quantity: move.quantity,
        lot_id: lotId,
        location_id: move.location_id[0],
        location_dest_id: move.location_dest_id[0],
      });
    }
  }
}
