/**
 * Inventory ↔ Odoo coupling switch.
 *
 * The portal is the source of truth for stock counts. Odoo's stock is not set
 * up on this deployment, so pushing approved counts into `stock.quant` is
 * coupling cost with no benefit (and the most failure-prone code in the module).
 *
 * Default OFF: approving a count just records it in the portal. Set
 * `INVENTORY_ODOO_SYNC=1` to re-enable the (aggregated, best-effort) write-back
 * and the system-quantity variance read — for a future opt-in Odoo sync.
 */
export function inventoryOdooSyncEnabled(): boolean {
  return process.env.INVENTORY_ODOO_SYNC === '1';
}
