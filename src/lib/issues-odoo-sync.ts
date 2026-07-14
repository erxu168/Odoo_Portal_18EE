/**
 * Issues Module — Odoo Sync Helper
 *
 * Mirrors equipment records from portal SQLite to Odoo 18 EE maintenance.equipment.
 * Portal is the source of truth. Odoo is a read-write mirror that reports can use.
 *
 * Requires the krawings_issues addon to be installed on Odoo (adds x_portal_id,
 * x_qr_code, x_portal_repair_count, x_portal_total_cost custom fields).
 *
 * All functions are failure-tolerant: a broken Odoo connection logs a warning
 * and returns null rather than throwing. The portal keeps working.
 */
import { getOdoo } from './odoo';
import { updateEquipment } from './issues-db';
import type { Equipment } from '@/types/issues';

/**
 * Upsert an equipment record into Odoo's maintenance.equipment table.
 * Looks up by x_portal_id; creates if missing, writes if found.
 *
 * On success: saves the returned Odoo ID back to the portal equipment row.
 * On failure: logs and returns null (portal operation still succeeds).
 */
export async function syncEquipmentToOdoo(eq: Equipment): Promise<number | null> {
  try {
    const odoo = getOdoo();

    // Build vals common to create and write
    const vals: Record<string, unknown> = {
      name: eq.name,
      x_portal_id: eq.id,
      x_qr_code: eq.qr_code,
      x_portal_repair_count: eq.repair_count,
      x_portal_total_cost: eq.total_repair_cost,
    };

    if (eq.model) vals.model = eq.model;
    if (eq.serial_number) vals.serial_no = eq.serial_number;
    if (eq.location) vals.location = eq.location;
    if (eq.purchase_date) vals.effective_date = eq.purchase_date;
    if (eq.purchase_cost !== null) vals.cost = eq.purchase_cost;

    // Vendor partner: resolve or create
    if (eq.vendor_name) {
      const partnerId = await resolveOrCreatePartner(eq.vendor_name);
      if (partnerId) vals.partner_id = partnerId;
    }

    // Warranty: field name varies by Odoo 18 build. Try warranty_date first.
    // If that fails we'll retry without it — worst case warranty isn't synced.
    if (eq.warranty_expires) {
      vals.warranty_date = eq.warranty_expires;
    }

    // Upsert: search by x_portal_id
    const existing = await odoo.searchRead(
      'maintenance.equipment',
      [['x_portal_id', '=', eq.id]],
      ['id'],
      { limit: 1 },
    );

    let odooId: number;
    if (existing && existing.length > 0) {
      odooId = existing[0].id;
      try {
        await odoo.write('maintenance.equipment', [odooId], vals);
      } catch (e) {
        // Retry without warranty_date (may not exist on this build)
        if (vals.warranty_date) {
          delete vals.warranty_date;
          await odoo.write('maintenance.equipment', [odooId], vals);
        } else {
          throw e;
        }
      }
      console.log(`[issues-odoo-sync] updated Odoo equipment ${odooId} for portal ${eq.id}`);
    } else {
      try {
        odooId = await odoo.create('maintenance.equipment', vals);
      } catch (e) {
        if (vals.warranty_date) {
          delete vals.warranty_date;
          odooId = await odoo.create('maintenance.equipment', vals);
        } else {
          throw e;
        }
      }
      console.log(`[issues-odoo-sync] created Odoo equipment ${odooId} for portal ${eq.id}`);
    }

    // Save the Odoo ID back to the portal so we can correlate later
    if (odooId && eq.odoo_equipment_id !== odooId) {
      updateEquipment(eq.id, { odoo_equipment_id: odooId });
    }

    return odooId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[issues-odoo-sync] failed for equipment ${eq.id}: ${msg}`);
    return null;
  }
}

/**
 * Find a res.partner by name. If not found, create a new supplier partner.
 * Returns partner ID or null on failure.
 */
async function resolveOrCreatePartner(name: string): Promise<number | null> {
  try {
    const odoo = getOdoo();
    // Try supplier first
    const suppliers = await odoo.searchRead(
      'res.partner',
      [
        ['name', '=', name],
        ['supplier_rank', '>', 0],
      ],
      ['id'],
      { limit: 1 },
    );
    if (suppliers && suppliers.length > 0) return suppliers[0].id;

    // Any partner with that name
    const any = await odoo.searchRead(
      'res.partner',
      [['name', '=', name]],
      ['id'],
      { limit: 1 },
    );
    if (any && any.length > 0) return any[0].id;

    // Create a new supplier partner
    const newId = await odoo.create('res.partner', {
      name,
      supplier_rank: 1,
      company_type: 'company',
    });
    return newId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[issues-odoo-sync] partner resolve failed for "${name}": ${msg}`);
    return null;
  }
}

/**
 * Health check — confirms the krawings_issues addon is installed
 * (by verifying the x_portal_id custom field exists on maintenance.equipment).
 */
export async function checkOdooAddonInstalled(): Promise<boolean> {
  try {
    const odoo = getOdoo();
    const fields = await odoo.call('maintenance.equipment', 'fields_get', [['x_portal_id']], {});
    return !!(fields && fields.x_portal_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[issues-odoo-sync] addon check failed: ${msg}`);
    return false;
  }
}
