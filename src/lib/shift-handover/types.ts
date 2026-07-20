/**
 * Shift Handover — database row types. Pure type declarations (no runtime import
 * of the DB) so both server and client can share them.
 */

export type ProductKind = 'finished' | 'component' | 'other';
export type BatchStatus = 'open' | 'closed';
export type ActionPriority = 'normal' | 'important' | 'urgent' | 'food_safety_critical';
export type ActionStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type HandoverStatus =
  | 'draft'
  | 'submitted'
  | 'acknowledged'
  | 'acknowledged_with_discrepancies'
  | 'superseded';
export type DiscrepancyType =
  | 'confirmed'
  | 'quantity_differs'
  | 'product_not_found'
  | 'wrong_location'
  | 'wrong_state'
  | 'quality_issue'
  | 'temperature_issue'
  | 'other';
export type PhotoEntity = 'container' | 'batch' | 'action' | 'discrepancy' | 'acknowledgement';

export interface HandoverProduct {
  id: number;
  company_id: number;
  name: string;
  kind: ProductKind | string;
  unit: string | null;
  odoo_product_id: number | null;
  photo_policy: string;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface HandoverContainerType {
  id: number;
  company_id: number;
  name: string;
  category: string | null;
  capacity_label: string | null;
  reference_photo: string | null;
  internal_code: string | null;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface HandoverBatch {
  id: number;
  company_id: number;
  operational_date: string;
  product_id: number;
  product_name: string;
  shift_label: string | null;
  batch_code: string | null;
  produced_by_user_id: number | null;
  produced_by_name: string | null;
  produced_at: string;
  note: string | null;
  status: BatchStatus | string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface HandoverContainer {
  id: number;
  company_id: number;
  batch_id: number;
  product_id: number;
  container_code: string;
  container_type_id: number | null;
  fill_level: number | null;
  quantity_method: string | null;
  exact_quantity: number | null;
  unit: string | null;
  preparation_state: string | null;
  availability_state: string | null;
  storage_location_id: number | null;
  use_first: number;
  next_action: string | null;
  note: string | null;
  status: string;
  version: number;
  created_by_user_id: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface HandoverPhoto {
  id: number;
  company_id: number;
  entity_type: PhotoEntity | string;
  entity_id: number;
  event: string | null;
  photo: string;
  caption: string | null;
  uploaded_by_user_id: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  active: number;
  replaced_photo_id: number | null;
}

export interface HandoverAction {
  id: number;
  company_id: number;
  operational_date: string;
  batch_id: number | null;
  container_id: number | null;
  handover_id: number | null;
  instruction: string;
  priority: string;
  assigned_role: string | null;
  due_at: string | null;
  status: string;
  completed_by_user_id: number | null;
  completed_by_name: string | null;
  completed_at: string | null;
  completion_note: string | null;
  completion_photo_id: number | null;
  version: number;
  created_by_user_id: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface HandoverRecord {
  id: number;
  company_id: number;
  operational_date: string;
  outgoing_shift_label: string | null;
  incoming_shift_label: string | null;
  status: string;
  summary_note: string | null;
  submitted_by_user_id: number | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  snapshot_hash: string | null;
  acknowledged_by_user_id: number | null;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  ack_outcome: string | null;
  superseded_by_id: number | null;
  version: number;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface HandoverDiscrepancy {
  id: number;
  company_id: number;
  handover_id: number;
  snapshot_container_id: number | null;
  discrepancy_type: string;
  expected_value: string | null;
  reported_value: string | null;
  note: string | null;
  photo_id: number | null;
  reported_by_user_id: number | null;
  reported_by_name: string | null;
  reported_at: string;
  resolved_by_user_id: number | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  status: string;
}

export interface HandoverEvent {
  id: number;
  company_id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  entity_type: string;
  entity_id: number | null;
  action: string;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  operational_date: string | null;
  created_at: string;
}
