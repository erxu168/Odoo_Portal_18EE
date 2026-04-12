// src/types/rentals.ts
// Properties & Tenancies module — type definitions
// Krawings Portal · krawings_rentals v1.1.0

// ============================================================================
// Enums / unions
// ============================================================================

export type PropertyType = 'apartment_wg' | 'house' | 'studio' | 'other';

export type RoomStatus = 'occupied' | 'vacant' | 'reserved' | 'maintenance';

export type ContractType = 'standard' | 'staffel' | 'index';

export type TenancyStatus = 'pending' | 'active' | 'ending' | 'ended' | 'cancelled';

export type RentStepType = 'staffel' | 'index' | 'erhoehung';

export type RentIncreaseStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'cancelled';

export type PaymentStatus =
  | 'expected'
  | 'matched'
  | 'partial'
  | 'missing'
  | 'waived'
  | 'carried'
  | 'deducted_from_kaution';

export type SepaFormat = 'camt053' | 'mt940' | 'csv';

export type SepaTxStatus = 'matched' | 'partial' | 'unmatched' | 'manual_assigned' | 'ignored';

export type UtilityCategory =
  | 'electricity'
  | 'gas'
  | 'water'
  | 'internet'
  | 'insurance'
  | 'recycling'
  | 'other';

export type MeterType = 'electricity' | 'gas' | 'water_cold' | 'water_hot' | 'heating';

export type ContainerType = 'restmuell' | 'papier' | 'bio' | 'gelber_sack' | 'glas' | 'sondermuell';

export type PickupFrequency = 'weekly' | 'biweekly' | 'monthly' | 'on_demand';

export type CredentialCategory = UtilityCategory | 'hausverwaltung' | 'bank' | 'other';

export type AuditAction = 'view' | 'reveal' | 'create' | 'update' | 'delete';

export type InspectionType = 'move_in' | 'move_out';

export type InspectionStatus = 'draft' | 'in_progress' | 'signed' | 'archived';

export type ItemCondition = 'neuwertig' | 'gut' | 'gebrauchsspuren' | 'beschaedigt';

export type InvitationStatus = 'sent' | 'opened' | 'filled' | 'signed' | 'expired' | 'cancelled';

export type AlertType =
  | 'contract_ending_90'
  | 'contract_ending_60'
  | 'contract_ending_30'
  | 'rent_increase_eligible'
  | 'staffel_step_due'
  | 'index_cpi_update'
  | 'payment_overdue'
  | 'inspection_due';

export type AlertStatus = 'active' | 'dismissed' | 'resolved';

// ============================================================================
// Core entities
// ============================================================================

export interface Property {
  id: number;
  street: string;
  plz: string;
  city: string;
  floor_unit: string | null;
  type: PropertyType;
  total_size_sqm: number | null;
  owner: string | null;
  hausverwaltung: string | null;
  mietspiegel_eur_per_sqm: number | null;
  mietspiegel_updated_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: number;
  property_id: number;
  room_code: string;
  room_name: string | null;
  size_sqm: number;
  base_kaltmiete: number;
  utility_share: number;
  status: RoomStatus;
  furnished: 0 | 1;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomFurniture {
  id: number;
  room_id: number;
  item_name: string;
  quantity: number;
  condition: ItemCondition | null;
  checked: 0 | 1;
  notes: string | null;
  item_order: number;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  dob: string | null;
  nationality: string | null;
  employer: string | null;
  monthly_net_income: number | null;
  id_doc_path: string | null;
  schufa_doc_path: string | null;
  payslip_paths_json: string | null;
  emergency_contact: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tenancy {
  id: number;
  room_id: number;
  tenant_id: number;
  contract_type: ContractType;
  start_date: string;
  end_date: string | null;
  kaltmiete: number;
  nebenkosten: number;
  warmmiete: number;
  kaution: number;
  kaution_received: number;
  status: TenancyStatus;
  contract_pdf_path: string | null;
  signed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenancyRentStep {
  id: number;
  tenancy_id: number;
  effective_date: string;
  new_kaltmiete: number;
  type: RentStepType;
  reason: string | null;
  applied: 0 | 1;
  applied_at: string | null;
  created_at: string;
}

export interface RentIncrease {
  id: number;
  tenancy_id: number;
  current_kaltmiete: number;
  proposed_kaltmiete: number;
  increase_pct: number;
  proposed_effective_date: string;
  legal_checks_json: string;
  mietspiegel_eur_per_sqm: number;
  status: RentIncreaseStatus;
  pdf_path: string | null;
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Payments / SEPA
// ============================================================================

export interface Payment {
  id: number;
  tenancy_id: number;
  expected_date: string;
  expected_amount: number;
  received_amount: number;
  received_date: string | null;
  sepa_tx_id: number | null;
  status: PaymentStatus;
  shortfall: number;
  resolution_note: string | null;
  resolved_by_user_id: number | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SepaImport {
  id: number;
  filename: string;
  format: SepaFormat;
  bank_name: string | null;
  iban: string | null;
  total_credits: number;
  tx_count: number;
  raw_path: string | null;
  imported_by_user_id: number;
  imported_at: string;
}

export interface SepaTransaction {
  id: number;
  import_id: number;
  tx_date: string;
  amount: number;
  counterparty_iban: string | null;
  counterparty_bic: string | null;
  counterparty_name: string | null;
  purpose: string | null;
  end_to_end_id: string | null;
  status: SepaTxStatus;
  matched_payment_id: number | null;
  matched_by: 'auto_iban_amount' | 'auto_iban_fuzzy' | 'auto_purpose' | 'manual' | null;
  created_at: string;
}

// ============================================================================
// Property utilities / meters / recycling / vault
// ============================================================================

export interface UtilityProvider {
  id: number;
  property_id: number;
  category: UtilityCategory;
  provider_name: string;
  account_no: string | null;
  monthly_cost: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeterReading {
  id: number;
  property_id: number;
  meter_type: MeterType;
  meter_no: string;
  reading_value: number;
  reading_unit: string;
  reading_date: string;
  photo_path: string | null;
  source: 'manual' | 'inspection';
  inspection_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface RecyclingContainer {
  id: number;
  property_id: number;
  container_type: ContainerType;
  size_liters: number | null;
  company: string;
  pickup_day: string;
  frequency: PickupFrequency;
  monthly_cost: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialEntry {
  id: number;
  property_id: number;
  label: string;
  category: CredentialCategory;
  url: string | null;
  username_enc: string;
  password_enc: string;
  notes_enc: string | null;
  iv: string;
  auth_tag: string;
  created_by_user_id: number;
  created_at: string;
  updated_at: string;
}

export interface CredentialEntryDecrypted {
  id: number;
  property_id: number;
  label: string;
  category: CredentialCategory;
  url: string | null;
  username: string;
  password: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialAuditLog {
  id: number;
  vault_id: number | null;
  user_id: number;
  action: AuditAction;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

// ============================================================================
// Contract templates & tenant self-service invitations
// ============================================================================

export interface ContractTemplate {
  id: number;
  name: string;
  contract_type: ContractType;
  file_path: string;
  fields_json: string;
  active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface TenancyInvitation {
  id: number;
  template_id: number;
  room_id: number;
  prospect_name: string;
  prospect_email: string;
  prospect_phone: string | null;
  proposed_start_date: string;
  proposed_kaltmiete: number;
  proposed_nebenkosten: number;
  proposed_kaution: number;
  contract_type: ContractType;
  token: string;
  status: InvitationStatus;
  form_data_json: string | null;
  tenant_signature_path: string | null;
  landlord_signature_path: string | null;
  contract_pdf_path: string | null;
  tenancy_id: number | null;
  sent_at: string;
  opened_at: string | null;
  filled_at: string | null;
  signed_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Übergabeprotokoll (move-in / move-out inspection)
// ============================================================================

export interface Inspection {
  id: number;
  tenancy_id: number;
  room_id: number;
  property_id: number;
  type: InspectionType;
  inspection_date: string;
  inspector_name: string;
  status: InspectionStatus;
  tenant_signature_path: string | null;
  landlord_signature_path: string | null;
  tenant_signed_at: string | null;
  landlord_signed_at: string | null;
  pdf_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InspectionItem {
  id: number;
  inspection_id: number;
  category: string;
  item_label: string;
  condition: ItemCondition | null;
  notes: string | null;
  photo_paths_json: string;
  item_order: number;
  is_custom: 0 | 1;
  created_at: string;
}

export interface PropertyInspectionItem {
  id: number;
  property_id: number;
  category: string;
  item_label: string;
  item_order: number;
  active: 0 | 1;
  created_at: string;
}

// ============================================================================
// Alerts
// ============================================================================

export interface Alert {
  id: number;
  type: AlertType;
  tenancy_id: number | null;
  property_id: number | null;
  room_id: number | null;
  due_date: string | null;
  title: string;
  body: string;
  payload_json: string | null;
  status: AlertStatus;
  created_at: string;
  resolved_at: string | null;
}

// ============================================================================
// Composed/joined views
// ============================================================================

export interface PropertyWithStats extends Property {
  rooms_total: number;
  rooms_occupied: number;
  monthly_income: number;
  monthly_costs: number;
  occupancy_pct: number;
}

export interface RoomWithTenancy extends Room {
  current_tenancy: Tenancy | null;
  current_tenant: Tenant | null;
}

export interface TenancyFull extends Tenancy {
  tenant: Tenant;
  room: Room;
  property: Property;
  next_rent_step: TenancyRentStep | null;
  last_payment: Payment | null;
}

// ============================================================================
// Fixed inspection template (shipped in code, not in DB)
// ============================================================================

export interface InspectionTemplateCategory {
  category: string;
  category_label_de: string;
  items: { label: string; order: number }[];
}

export const INSPECTION_FIXED_TEMPLATE: InspectionTemplateCategory[] = [
  {
    category: 'walls_ceiling',
    category_label_de: 'Wände & Decke',
    items: [
      { label: 'Wände allgemein', order: 1 },
      { label: 'Decke', order: 2 },
      { label: 'Tapete / Anstrich', order: 3 },
    ],
  },
  {
    category: 'floors',
    category_label_de: 'Böden & Sockelleisten',
    items: [
      { label: 'Bodenbelag', order: 1 },
      { label: 'Sockelleisten', order: 2 },
    ],
  },
  {
    category: 'windows_blinds',
    category_label_de: 'Fenster & Rollläden',
    items: [
      { label: 'Fensterscheiben', order: 1 },
      { label: 'Fensterrahmen', order: 2 },
      { label: 'Rollläden / Jalousien', order: 3 },
      { label: 'Fenstergriffe & Schlösser', order: 4 },
    ],
  },
  {
    category: 'bathroom',
    category_label_de: 'Bad & Sanitär',
    items: [
      { label: 'WC', order: 1 },
      { label: 'Waschbecken', order: 2 },
      { label: 'Dusche / Badewanne', order: 3 },
      { label: 'Fliesen & Fugen', order: 4 },
      { label: 'Armaturen', order: 5 },
      { label: 'Spiegel & Schränke', order: 6 },
    ],
  },
  {
    category: 'kitchen',
    category_label_de: 'Küche',
    items: [
      { label: 'Herd / Backofen', order: 1 },
      { label: 'Kühlschrank', order: 2 },
      { label: 'Spüle & Armatur', order: 3 },
      { label: 'Schränke', order: 4 },
    ],
  },
  {
    category: 'keys_handover',
    category_label_de: 'Schlüsselübergabe',
    items: [
      { label: 'Wohnungsschlüssel', order: 1 },
      { label: 'Haustürschlüssel', order: 2 },
      { label: 'Briefkastenschlüssel', order: 3 },
      { label: 'Kellerschlüssel', order: 4 },
    ],
  },
];
