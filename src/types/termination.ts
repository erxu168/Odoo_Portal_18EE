/**
 * Krawings Portal — Termination Types
 * Maps to kw.termination model on Odoo 18 EE.
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
  | 'archived'
  | 'cancelled';

export type CalcMethod = 'bgb' | 'receipt';

export type ResignationMethod = 'letter' | 'email' | 'verbal';

export type ZeugnisGrade = '1' | '2' | '3' | '4';

export const TERMINATION_TYPE_LABELS: Record<TerminationType, string> = {
  ordentlich: 'Ordentliche Kuendigung',
  ordentlich_probezeit: 'Ordentliche Kuendigung (Probezeit)',
  fristlos: 'Fristlose Kuendigung',
  aufhebung: 'Aufhebungsvertrag',
  bestaetigung: 'Kuendigungsbestaetigung',
};

export const TERMINATION_STATE_LABELS: Record<TerminationState, string> = {
  draft: 'Entwurf',
  confirmed: 'Bestaetigt',
  signed: 'Unterschrieben',
  archived: 'Archiviert',
  cancelled: 'Storniert',
};

export const TERMINATION_STATE_BADGE: Record<TerminationState, string> = {
  draft: 'draft',
  confirmed: 'confirmed',
  signed: 'done',
  archived: 'neutral',
  cancelled: 'cancel',
};

export interface Termination {
  id: number;
  employee_id: [number, string];
  employee_name: string;
  company_id: [number, string];
  termination_type: TerminationType;
  state: TerminationState;
  letter_date: string;           // YYYY-MM-DD
  last_working_day: string | false;
  notice_period_text: string | false;
  calc_method: CalcMethod;
  receipt_date: string | false;
  resignation_method: ResignationMethod | false;
  resignation_received_date: string | false;
  in_probation: boolean;
  probation_end: string | false;
  employee_start_date: string | false;
  tenure_years: number;
  employee_street: string | false;
  employee_zip: string | false;
  employee_city: string | false;
  garden_leave: boolean;
  include_severance: boolean;
  severance_amount: number;
  incident_date: string | false;
  incident_description: string | false;
  incident_overdue: boolean;
  sent_to_accountant: boolean;
  sent_to_accountant_date: string | false;
  sign_state: 'not_started' | 'employer_signed' | 'fully_signed';
  zeugnis_grade: ZeugnisGrade | false;
  departure_date: string | false;
  written_resignation_received: boolean;
}

export interface TerminationCreatePayload {
  employee_id: number;
  company_id: number;
  termination_type: TerminationType;
  letter_date: string;
  calc_method: CalcMethod;
  receipt_date?: string;
  resignation_method?: ResignationMethod;
  resignation_received_date?: string;
  garden_leave?: boolean;
  include_severance?: boolean;
  severance_amount?: number;
  incident_date?: string;
  incident_description?: string;
}

/** Fields to read from Odoo for list view */
export const TERMINATION_LIST_FIELDS = [
  'id', 'employee_id', 'employee_name', 'company_id',
  'termination_type', 'state', 'letter_date',
  'last_working_day', 'notice_period_text',
  'sent_to_accountant', 'in_probation',
] as const;

/** Fields to read from Odoo for detail view */
export const TERMINATION_DETAIL_FIELDS = [
  'id', 'employee_id', 'employee_name', 'company_id',
  'termination_type', 'state', 'letter_date',
  'last_working_day', 'notice_period_text', 'calc_method',
  'receipt_date', 'resignation_method', 'resignation_received_date',
  'in_probation', 'probation_end', 'employee_start_date', 'tenure_years',
  'employee_street', 'employee_zip', 'employee_city',
  'garden_leave', 'include_severance', 'severance_amount',
  'incident_date', 'incident_description', 'incident_overdue',
  'sent_to_accountant', 'sent_to_accountant_date',
  'sign_state', 'zeugnis_grade', 'departure_date',
  'written_resignation_received',
] as const;
