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

export interface CountingTemplate {
  id: number;
  name: string;
  frequency: Frequency;
  schedule_days: number[];  // JS weekday numbers: 0=Sun, 1=Mon, ..., 6=Sat
  location_id: number;
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
  counted_qty: number;
  system_qty: number | null;
  diff: number | null;
  uom: string;
  notes: string | null;
  counted_by: number;
  counted_at: string;
}

export interface QuickCount {
  id: number;
  product_id: number;
  product_name?: string;
  location_id: number;
  counted_qty: number;
  uom: string;
  counted_by: number;
  counted_by_name?: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
}
