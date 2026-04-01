/**
 * Termination module types.
 * Mirrors kw.termination Odoo model fields.
 */

export type TerminationType =
  | 'ordentlich'
  | 'ordentlich_probezeit'
  | 'fristlos'
  | 'aufhebung'
  | 'bestaetigung';

export type TerminationState =
  | 'draft'
  | 'confirmed'
  | 'signed'
  | 'delivered'
  | 'archived'
  | 'cancelled';

export type CalcMethod = 'bgb' | 'receipt';

export type DeliveryMethod =
  | 'einschreiben_rueckschein'
  | 'einwurf_einschreiben'
  | 'personal'
  | 'bote';

export interface TerminationRecord {
  id: number;
  employee_id: [number, string];
  company_id: [number, string];
  termination_type: TerminationType;
  state: TerminationState;
  letter_date: string; // YYYY-MM-DD
  receipt_date: string | false;
  calc_method: CalcMethod;
  notice_period_text: string;
  last_working_day: string | false;
  employee_name: string;
  employee_street: string;
  employee_city: string;
  employee_zip: string;
  employee_start_date: string | false;
  tenure_years: number;
  in_probation: boolean;
  probation_end: string | false;
  // Fristlos
  incident_date: string | false;
  incident_description: string | false;
  // Aufhebung
  include_severance: boolean;
  severance_amount: number;
  garden_leave: boolean;
  // Bestaetigung
  resignation_received_date: string | false;
  // PDF
  pdf_attachment_id: [number, string] | false;
  signed_pdf_attachment_id: [number, string] | false;
  // Delivery
  delivery_method: DeliveryMethod | false;
  delivery_date: string | false;
  delivery_tracking_number: string | false;
  delivery_witness: string | false;
  delivery_confirmed: boolean;
  delivery_confirmed_date: string | false;
  delivery_proof_attachment_id: [number, string] | false;
  delivery_notes: string | false;
  // Accountant
  sent_to_accountant: boolean;
  sent_to_accountant_date: string | false;
  // Archive
  archive_scheduled?: boolean;
  display_name: string;
}

export interface TerminationCreateValues {
  employee_id: number;
  company_id: number;
  termination_type: TerminationType;
  calc_method?: CalcMethod;
  letter_date?: string;
  receipt_date?: string;
  employee_street?: string;
  employee_city?: string;
  employee_zip?: string;
  // Fristlos
  incident_date?: string;
  incident_description?: string;
  // Aufhebung
  last_working_day?: string;
  include_severance?: boolean;
  severance_amount?: number;
  garden_leave?: boolean;
  // Bestaetigung
  resignation_received_date?: string;
}

export const TERMINATION_TYPE_LABELS: Record<TerminationType, string> = {
  ordentlich: 'Ordentliche K\u00fcndigung',
  ordentlich_probezeit: 'Ordentliche K\u00fcndigung (Probezeit)',
  fristlos: 'Fristlose K\u00fcndigung',
  aufhebung: 'Aufhebungsvertrag',
  bestaetigung: 'K\u00fcndigungsbest\u00e4tigung',
};

export const STATE_LABELS: Record<TerminationState, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  signed: 'In Transit',
  delivered: 'Delivered',
  archived: 'Archived',
  cancelled: 'Cancelled',
};

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  einschreiben_rueckschein: 'Einschreiben mit R\u00fcckschein',
  einwurf_einschreiben: 'Einwurf-Einschreiben',
  personal: 'Pers\u00f6nliche \u00dcbergabe',
  bote: 'Bote (mit Zeuge)',
};

/** All fields to fetch from Odoo for list views */
export const TERMINATION_LIST_FIELDS = [
  'id', 'employee_id', 'employee_name', 'company_id', 'termination_type', 'state',
  'letter_date', 'last_working_day', 'notice_period_text',
  'delivery_method', 'delivery_confirmed', 'sent_to_accountant',
  'pdf_attachment_id', 'signed_pdf_attachment_id',
];

/** All fields to fetch from Odoo for detail views */
export const TERMINATION_DETAIL_FIELDS = [
  ...TERMINATION_LIST_FIELDS,
  'employee_id', 'calc_method', 'receipt_date',
  'employee_street', 'employee_city', 'employee_zip',
  'employee_start_date', 'tenure_years', 'in_probation', 'probation_end',
  'incident_date', 'incident_description',
  'include_severance', 'severance_amount', 'garden_leave',
  'resignation_received_date',
  'delivery_date', 'delivery_tracking_number', 'delivery_witness',
  'delivery_confirmed_date', 'delivery_proof_attachment_id', 'delivery_notes',
  'sent_to_accountant_date', 'display_name',
];
