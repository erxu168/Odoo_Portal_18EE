/**
 * Krawings Inventory Module — Type definitions
 */

// ── Odoo-sourced data (read-only from portal perspective) ──

export interface OdooProduct {
  id: number;
  name: string;
  categ_id: [number, string];
  uom_id: [number, string];
  type: string;
  barcode: string | false;
  default_code?: string | null;   // order code ("Internal Reference" field)
  display_name?: string;          // what staff see = internal product name
  supplier_ref?: string | null;   // matched vendor name/code (search confirm only)
  is_draft?: boolean;
}

export interface OdooLocation {
  id: number;
  name: string;
  complete_name: string;
  barcode: string | false;
}

export interface OdooQuant {
  id: number;
  product_id: [number, string];
  location_id: [number, string];
  quantity: number;
  inventory_quantity: number;
  inventory_quantity_set: boolean;
}

export interface OdooDepartment {
  id: number;
  name: string;
}

export interface OdooPlanningRole {
  id: number;
  name: string;
}

// ── Portal-side data (SQLite) ──

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'adhoc';
export type AssignType = 'person' | 'department' | 'shift' | null;
export type SessionStatus = 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected';
export type CountMode = 'simple' | 'pack_loose';

export interface CountingTemplate {
  id: number;
  name: string;
  frequency: Frequency;
  schedule_days: number[];  // JS weekday numbers: 0=Sun, 1=Mon, ..., 6=Sat
  location_id: number;
  company_id?: number | null;  // which restaurant this list belongs to
  location_name?: string;
  category_ids: number[];   // JSON stored
  product_ids: number[];    // JSON stored — explicit product picks
  assign_type: AssignType;
  assign_id: number | null; // user_id, department_id, or planning.role id
  assign_label?: string;
  active: boolean;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface CountingSession {
  id: number;
  template_id: number;
  template_name?: string;
  template_frequency?: Frequency;
  scheduled_date: string;
  status: SessionStatus;
  location_id: number;
  company_id?: number | null;  // restaurant of the template (for staff visibility)
  location_name?: string;
  assigned_user_id: number | null;
  assigned_user_name?: string;
  submitted_at: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

export interface CountEntry {
  id: number;
  session_id: number;
  product_id: number;
  product_name?: string;
  counted_qty: number;                // base-unit total (bottles) — what Odoo gets
  system_qty: number | null;
  diff: number | null;
  uom: string;
  notes: string | null;
  counted_by: number;
  counted_at: string;
  crate_qty?: number | null;          // crates as entered (audit / review replay)
  loose_qty?: number | null;          // loose base units as entered
  units_per_crate?: number | null;    // crate size snapshot at count time
  count_location_id?: number;         // which spot this count is for (0 = no specific spot / legacy)
  out_of_stock?: boolean;             // deliberate "none here" (≠ a counted 0, ≠ not-counted)
  count_mode?: CountMode | null;      // how it was counted (snapshot)
  pack_label?: string | null;         // pack word snapshot ('crate'…)
  loose_label?: string | null;        // single-unit word snapshot ('bottles'…)
  odoo_qty?: number | null;           // converted base qty safe to write to Odoo (null = portal-only)
}

export interface QuickCount {
  id: number;
  product_id: number;
  product_name?: string;
  location_id: number;
  company_id: number | null;          // which restaurant (null = legacy, quarantined)
  counted_qty: number;                // base-unit total (bottles)
  uom: string;
  counted_by: number;
  counted_by_name?: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  crate_qty?: number | null;
  loose_qty?: number | null;
  units_per_crate?: number | null;
  out_of_stock?: boolean;             // deliberate "none here"
  count_mode?: CountMode | null;
  pack_label?: string | null;
  loose_label?: string | null;
  odoo_qty?: number | null;           // converted base qty safe to write to Odoo
}

// ── Location layer (portal SQLite) ──
export type LocationKind = 'area' | 'fridge' | 'freezer' | 'dry' | 'zone' | 'bar';

export interface CountLocation {
  id: number;
  parent_id: number | null;
  company_id: number;
  name: string;
  kind: LocationKind | string;
  description: string | null;
  photo: string | null;            // base64 data URL (Phase 1; object storage in Phase 5)
  sort_order: number;              // walking-route order among siblings
  odoo_location_id: number | null; // optional real stock.location for a future write
  active: boolean;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface ProductPlacement {
  odoo_product_id: number;
  count_location_id: number;
  shelf_sort: number;              // order on the shelf
}

/** A product placed at a spot within ONE specific list (template). */
export interface TemplatePlacement {
  template_id: number;
  odoo_product_id: number;
  count_location_id: number;
  shelf_sort: number;
}

/**
 * Frozen snapshot of one thing to count (a product at a spot) for a session,
 * captured at session creation so later template edits never re-route it.
 */
export interface SessionCountItem {
  session_id: number;
  odoo_product_id: number;
  count_location_id: number;
  shelf_sort: number;
  requires_photo: boolean;
  count_mode: CountMode | null;
  pack_label: string | null;
  loose_label: string | null;
  units_per_crate: number | null;
}

/** A goods-received (purchased-in) entry — what came into stock, for the
 *  opening + received − closing consumption math. Portal-owned, no Odoo. */
export interface StockReceipt {
  id: number;
  company_id: number;
  odoo_product_id: number;
  count_location_id: number;       // 0 = no specific spot
  qty_base: number;                // base-unit total (server-computed, like counts)
  crate_qty: number | null;        // audit: packs as entered
  loose_qty: number | null;        // audit: loose singles as entered
  units_per_crate: number | null;  // pack size snapshot
  uom: string;
  note: string | null;
  photo: string | null;            // optional delivery photo (base64)
  received_by: number;
  received_at: string;
  received_by_name?: string;       // join for display
  product_name?: string;           // resolved for display
}

/** One primary product picture (camera or upload), portal-owned. */
export interface ProductImage {
  odoo_product_id: number;
  image: string;                   // base64 data URL
  mime: string | null;
  updated_by: number | null;
  updated_at: string | null;
}
