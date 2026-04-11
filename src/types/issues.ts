/**
 * Krawings Issues & Requests Module — Type definitions
 *
 * "Issue" here = a staff-submitted incident or request (repair, injury, etc.)
 * Not to be confused with src/types/reports.ts which is for analytics/BI reports.
 */

// ── Issue types ──

export type IssueType =
  | 'repair'
  | 'purchase_request'
  | 'injury'
  | 'security'
  | 'food_safety'
  | 'hazard'
  | 'suggestion'
  | 'other';

export type IssueStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'under_review'
  | 'resolved'
  | 'rejected';

export type Urgency = 'normal' | 'urgent';
export type Priority = 'normal' | 'high' | 'critical';
export type MediaType = 'photo' | 'video';
export type MediaPhase = 'before' | 'after';

/** Issue types that are restricted (only reporter + manager/admin can see) */
export const RESTRICTED_TYPES: IssueType[] = ['injury', 'security', 'food_safety'];

/** Issue types that auto-set urgency to 'urgent' */
export const AUTO_URGENT_TYPES: IssueType[] = ['injury', 'security'];

// ── Issue core ──

export interface Issue {
  id: string;
  type: IssueType;
  status: IssueStatus;
  urgency: Urgency;
  title: string;
  description: string;
  location: string;
  location_custom: string | null;
  department: string;
  reporter_id: number;
  reporter_name?: string;
  assigned_to: string | null;
  priority: Priority;
  deadline: string | null;
  equipment_text: string | null;
  equipment_id: string | null;
  equipment_name?: string;
  restricted: boolean;
  manager_notes: string | null;
  resolution: string | null;
  repair_cost: number | null;
  created_at: string;
  updated_at: string;
}

// ── Type-specific data (stored as JSON in issue_type_data) ──

export interface RepairData {
  category: string | null;
  qr_scanned: boolean;
}

export interface PurchaseRequestData {
  item_name: string;
  quantity: number | null;
  unit: string | null;
  reason: string;
  approved_by: number | null;
  approved_at: string | null;
  rejected_by: number | null;
  rejected_reason: string | null;
  purchase_order_id: string | null;
}

export interface InjuryData {
  injured_person: string;
  person_type: 'staff' | 'customer';
  injury_type: string;
  first_aid: string | null;
  witnesses: string | null;
  bgn_required: boolean | null;
  bgn_checklist: BGNChecklist;
  bgn_filed: boolean;
}

export interface BGNChecklist {
  severity_assessed: boolean;
  scene_documented: boolean;
  witness_statements: boolean;
  unfallanzeige_filed: boolean;
  durchgangsarzt_referred: boolean;
  verbandbuch_updated: boolean;
}

export interface SecurityData {
  incident_type: string;
  people_involved: string | null;
  police_called: boolean | null;
  aktenzeichen: string | null;
  strafanzeige_filed: boolean | null;
}

export interface FoodSafetyData {
  product_affected: string | null;
  temperature: string | null;
  corrective_action: string | null;
}

export interface HazardData {
  hazard_description: string | null;
  risk_level: 'low' | 'medium' | 'high' | null;
  suggested_fix: string | null;
}

export interface SuggestionData {
  idea: string | null;
  expected_benefit: string | null;
}

export type IssueTypeData =
  | RepairData
  | PurchaseRequestData
  | InjuryData
  | SecurityData
  | FoodSafetyData
  | HazardData
  | SuggestionData
  | Record<string, never>;

// ── Media ──

export interface IssueMedia {
  id: string;
  issue_id: string;
  type: MediaType;
  phase: MediaPhase;
  file_path: string;
  thumbnail: string | null;
  created_at: string;
}

// ── Comments ──

export interface IssueComment {
  id: string;
  issue_id: string;
  author_id: number;
  author_name: string;
  text: string;
  created_at: string;
}

// ── Equipment ──

export interface Equipment {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  location: string;
  location_detail: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  warranty_expires: string | null;
  vendor_name: string | null;
  vendor_contact: string | null;
  qr_code: string;
  odoo_equipment_id: number | null;
  total_repair_cost: number;
  repair_count: number;
  created_at: string;
  updated_at: string;
}

export interface EquipmentDoc {
  id: string;
  equipment_id: string;
  name: string;
  file_path: string;
  doc_type: 'manual' | 'warranty' | 'invoice' | 'other';
}

export interface EquipmentPhoto {
  id: string;
  equipment_id: string;
  photo_type: 'equipment' | 'nameplate' | 'other';
  file_path: string;
  thumbnail: string | null;
}

// ── Notification config ──

export type NotificationChannel = 'badge' | 'push' | 'email' | 'whatsapp';

export interface NotificationRule {
  id: number;
  issue_type: IssueType | '*';
  urgency: Urgency | '*';
  channels: NotificationChannel[];
  active: boolean;
}

// ── Dashboard ──

export interface IssuesDashboardData {
  active_count: number;
  needs_action: number;
  restricted_count: number;
  equipment_count: number;
  recent: Issue[];
}

// ── API request/response shapes ──

export interface CreateIssueInput {
  type: IssueType;
  description: string;
  location: string;
  location_custom?: string;
  department: string;
  urgency?: Urgency;
  equipment_text?: string;
  type_data: IssueTypeData;
  media?: { data: string; type: MediaType }[];
}

export interface UpdateIssueInput {
  status?: IssueStatus;
  assigned_to?: string;
  priority?: Priority;
  deadline?: string;
  equipment_id?: string;
  manager_notes?: string;
  resolution?: string;
  repair_cost?: number;
  type_data?: Partial<IssueTypeData>;
}
