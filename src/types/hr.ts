// =================================================================
// HR / Onboarding Types
// Maps to Odoo 18 EE hr.employee + krawings_hr_datev custom fields
// =================================================================

export type OnboardingStatus =
  | 'new'
  | 'data_pending'
  | 'data_complete'
  | 'docs_pending'
  | 'docs_complete'
  | 'contract_pending'
  | 'contract_signed'
  | 'complete';

export type Gender = 'male' | 'female' | 'other';
export type MaritalStatus = 'single' | 'married' | 'cohabitant' | 'widower' | 'divorced';
export type Steuerklasse = '1' | '2' | '3' | '4' | '5' | '6';
export type Konfession = 'ev' | 'rk' | 'ak' | 'lt' | 'rf' | 'jd' | 'fm' | 'fg' | '--';
export type KVTyp = 'gesetzlich' | 'privat' | 'geringfuegig';
export type Befristung = 'unbefristet' | 'befristet' | 'befristet_aussicht';
export type AufenthaltstitelTyp =
  | 'unbefristet' | 'befristet' | 'blau' | 'icr'
  | 'duldung' | 'gestattung' | 'visum'
  | 'eu_buerger' | 'deutsch';

export interface EmployeeData {
  id: number;
  name: string;
  department_id: [number, string] | false;
  job_title: string | false;
  work_email: string | false;
  birthday: string | false;
  gender: Gender | false;
  marital: MaritalStatus;
  country_id: [number, string] | false;
  place_of_birth: string | false;
  country_of_birth: [number, string] | false;
  children: number;
  disabled: boolean;
  kw_geburtsname: string | false;
  private_street: string | false;
  private_street2: string | false;
  private_zip: string | false;
  private_city: string | false;
  private_country_id: [number, string] | false;
  private_email: string | false;
  private_phone: string | false;
  emergency_contact: string | false;
  emergency_phone: string | false;
  kw_emergency_relation: string | false;
  bank_account_id: [number, string] | false;
  identification_id: string | false;
  kw_steuer_id: string | false;
  kw_steuerklasse: Steuerklasse | false;
  kw_konfession: Konfession;
  kw_kinderfreibetrag: number;
  ssnid: string | false;
  kw_krankenkasse_name: string | false;
  kw_kv_typ: KVTyp | false;
  kw_beschaeftigungsbeginn: string | false;
  kw_wochenarbeitszeit: number;
  kw_taetigkeit_ba: string | false;
  kw_befristung: Befristung;
  kw_befristung_bis: string | false;
  kw_probezeit_bis: string | false;
  kw_aufenthaltstitel_typ: AufenthaltstitelTyp | false;
  passport_id: string | false;
  visa_no: string | false;
  permit_no: string | false;
  visa_expire: string | false;
  work_permit_expiration_date: string | false;
  kw_gesundheitszeugnis_datum: string | false;
  kw_gesundheitszeugnis_ablauf: string | false;
  kw_sofortmeldung_done: boolean;
  kw_sofortmeldung_datum: string | false;
  kw_onboarding_status: OnboardingStatus;
  kw_datev_complete: boolean;
  kw_doc_ausweis_ok: boolean;
  kw_doc_steuer_id_ok: boolean;
  kw_doc_sv_ausweis_ok: boolean;
  kw_doc_gesundheitszeugnis_ok: boolean;
  kw_doc_aufenthaltstitel_ok: boolean;
  kw_doc_krankenkasse_ok: boolean;
  kw_doc_lohnsteuer_ok: boolean;
  kw_doc_vertrag_ok: boolean;
  kw_doc_count: number;
}

export const EMPLOYEE_READ_FIELDS: string[] = [
  'name', 'department_id', 'job_title', 'work_email',
  'birthday', 'gender', 'marital', 'country_id', 'place_of_birth',
  'country_of_birth', 'children', 'disabled', 'kw_geburtsname',
  'private_street', 'private_street2', 'private_zip', 'private_city',
  'private_country_id', 'private_email', 'private_phone',
  'emergency_contact', 'emergency_phone',
  'bank_account_id', 'identification_id',
  'kw_steuer_id', 'kw_steuerklasse', 'kw_konfession', 'kw_kinderfreibetrag',
  'ssnid', 'kw_krankenkasse_name', 'kw_kv_typ',
  'kw_beschaeftigungsbeginn', 'kw_wochenarbeitszeit', 'kw_taetigkeit_ba',
  'kw_befristung', 'kw_befristung_bis', 'kw_probezeit_bis',
  'kw_aufenthaltstitel_typ', 'passport_id', 'visa_no', 'permit_no',
  'visa_expire', 'work_permit_expiration_date',
  'kw_gesundheitszeugnis_datum', 'kw_gesundheitszeugnis_ablauf',
  'kw_sofortmeldung_done', 'kw_sofortmeldung_datum',
  'kw_onboarding_status', 'kw_datev_complete',
  'kw_doc_ausweis_ok', 'kw_doc_steuer_id_ok', 'kw_doc_sv_ausweis_ok',
  'kw_doc_gesundheitszeugnis_ok', 'kw_doc_aufenthaltstitel_ok',
  'kw_doc_krankenkasse_ok', 'kw_doc_lohnsteuer_ok',
  'kw_doc_vertrag_ok', 'kw_doc_count',
];

export const STEP_FIELDS: Record<string, string[]> = {
  personal: [
    'birthday', 'gender', 'marital', 'country_id', 'place_of_birth',
    'country_of_birth', 'children', 'disabled', 'kw_geburtsname',
    'private_street', 'private_street2', 'private_zip', 'private_city',
    'private_country_id', 'private_email', 'private_phone',
    'emergency_contact', 'emergency_phone',
  ],
  bank: [],
  tax: [
    'identification_id', 'kw_steuer_id', 'kw_steuerklasse',
    'kw_konfession', 'kw_kinderfreibetrag',
  ],
  insurance: ['ssnid', 'kw_krankenkasse_name', 'kw_kv_typ'],
  documents: [],
  review: ['kw_onboarding_status'],
};

export interface DocumentType {
  key: string;
  tagId: number;
  label: string;
  labelDe: string;
  required: boolean;
  helpText: string;
  helpUrl: string;
  icon: string;
}

export const DOCUMENT_TYPES: DocumentType[] = [
  { key: 'ausweis', tagId: 45, label: 'ID Card / Passport', labelDe: 'Ausweis', required: true, helpText: 'A copy of your passport or national ID card. Your employer needs this to verify your identity.', helpUrl: 'https://www.welcome-hub-germany.com/blog/working-in-germany', icon: '\ud83c\udde9\ud83c\uddea' },
  { key: 'steuer_id', tagId: 46, label: 'Tax ID Letter', labelDe: 'Steuer-ID Brief', required: true, helpText: 'The letter you received after Anmeldung with your 11-digit Steuer-Identifikationsnummer.', helpUrl: 'https://allaboutberlin.com/guides/tax-id-germany', icon: '\ud83d\udcc4' },
  { key: 'sv_ausweis', tagId: 47, label: 'SV Card', labelDe: 'SV-Ausweis', required: true, helpText: 'The card or letter from Deutsche Rentenversicherung showing your 12-digit Sozialversicherungsnummer.', helpUrl: 'https://allaboutberlin.com/guides/german-versicherungsnummer', icon: '\ud83d\udcb3' },
  { key: 'gesundheitszeugnis', tagId: 48, label: 'Rote Karte (Food Hygiene)', labelDe: 'Gesundheitszeugnis', required: true, helpText: 'Required by law to work with food in Germany. Official briefing on infection protection (IfSG \u00a743).', helpUrl: 'https://www.zenjob.com/en/job-training/health-certificate/', icon: '\ud83c\udfe5' },
  { key: 'aufenthaltstitel', tagId: 49, label: 'Residence Permit', labelDe: 'Aufenthaltstitel', required: false, helpText: 'Non-EU citizens need a valid work or residence permit before starting work.', helpUrl: 'https://www.nomadenberlin.com/working-in-berlin', icon: '\ud83c\udf0d' },
  { key: 'krankenkasse', tagId: 50, label: 'Health Insurance Certificate', labelDe: 'Krankenkassenbescheinigung', required: false, helpText: 'Membership confirmation from your health insurance provider.', helpUrl: 'https://www.nomadenberlin.com/working-in-berlin', icon: '\ud83c\udfe5' },
  { key: 'lohnsteuer', tagId: 51, label: 'Previous Tax Certificate', labelDe: 'Lohnsteuerbescheinigung', required: false, helpText: 'From your previous employer if you are changing jobs.', helpUrl: 'https://allaboutberlin.com/glossary/Steuerklasse', icon: '\ud83d\udcd1' },
  { key: 'vertrag', tagId: 52, label: 'Employment Contract', labelDe: 'Arbeitsvertrag', required: true, helpText: 'Your signed employment contract. Usually handled via Odoo Sign.', helpUrl: 'https://www.welcome-hub-germany.com/blog/working-in-germany', icon: '\ud83d\udcdd' },
];

export interface FieldExplainer {
  title: string;
  text: string;
  url?: string;
  urlLabel?: string;
}

export const FIELD_EXPLAINERS: Record<string, FieldExplainer> = {
  kw_geburtsname: { title: 'Birth Name', text: 'Your birth name if different from your current name (e.g. maiden name before marriage). Leave empty if unchanged.' },
  kw_steuer_id: { title: 'Tax ID (Steuer-ID)', text: 'Your 11-digit tax identification number. You received it by letter when you registered your address in Germany (Anmeldung).', url: 'https://allaboutberlin.com/guides/tax-id-germany', urlLabel: 'How to get your Steuer-ID' },
  kw_steuerklasse: { title: 'Tax Class (Steuerklasse)', text: 'Determines how much tax is deducted monthly. Most single employees are Class I. Married couples can choose III/V or IV/IV.', url: 'https://allaboutberlin.com/glossary/Steuerklasse', urlLabel: 'Learn more about tax classes' },
  kw_konfession: { title: 'Church Tax (Konfession)', text: 'If you are a registered member of certain churches in Germany, 8-9% of your income tax goes to church tax. Select "None" if not a member.', url: 'https://allaboutberlin.com/glossary/Kirchensteuer', urlLabel: 'Learn more about church tax' },
  kw_kinderfreibetrag: { title: 'Child Tax Allowance', text: 'Enter 0.5 per child if parents are separated, or 1.0 per child for full allowance. Enter 0 if no children.' },
  ssnid: { title: 'Social Security Number (SV-Nummer)', text: 'Your 12-digit social insurance number. You get it when you register with public health insurance.', url: 'https://allaboutberlin.com/guides/german-versicherungsnummer', urlLabel: 'How to find your SV-Nummer' },
  kw_krankenkasse_name: { title: 'Health Insurance (Krankenkasse)', text: 'Enter the FULL name (e.g. "Techniker Krankenkasse" or "AOK Nordost"), not just "AOK".', url: 'https://www.nomadenberlin.com/working-in-berlin', urlLabel: 'Guide to health insurance in Berlin' },
  bank_iban: { title: 'IBAN', text: 'Your German bank account number for salary payments. Starts with "DE" followed by 20 digits.', url: 'https://www.settle-in-berlin.com/open-bank-account-germany/', urlLabel: 'How to open a German bank account' },
};

export const HR_FOLDER_ID = 17;

export function calculateOnboardingPercent(emp: EmployeeData): number {
  const checks = [
    !!emp.birthday, !!emp.gender, !!emp.private_street,
    !!emp.private_zip, !!emp.private_city,
    !!emp.bank_account_id,
    !!emp.kw_steuer_id, !!emp.kw_steuerklasse,
    !!emp.ssnid, !!emp.kw_krankenkasse_name,
    emp.kw_doc_ausweis_ok, emp.kw_doc_steuer_id_ok,
    emp.kw_doc_sv_ausweis_ok, emp.kw_doc_gesundheitszeugnis_ok,
    emp.kw_doc_vertrag_ok,
    !!emp.kw_gesundheitszeugnis_datum, emp.kw_sofortmeldung_done,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
