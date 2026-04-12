// src/lib/rentals-db.ts
// Properties & Tenancies module — SQLite schema and helpers
// Krawings Portal · krawings_rentals v1.1.0
//
// Pattern matches src/lib/issues-db.ts:
//  - better-sqlite3
//  - lazy initialization (no db calls at import time)
//  - Berlin time helper for all timestamps
//  - WAL mode + foreign keys ON

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

const DB_DIR = process.env.PORTAL_DB_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'rentals.sqlite');

// ============================================================================
// Berlin time helper
// ============================================================================

export function berlinNow(): string {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return fmt.format(new Date());
}

export function berlinToday(): string {
  return berlinNow().slice(0, 10);
}

// ============================================================================
// Lazy init
// ============================================================================

export function getRentalsDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  return db;
}

// ============================================================================
// Schema
// ============================================================================

function initSchema(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      street TEXT NOT NULL,
      plz TEXT NOT NULL,
      city TEXT NOT NULL,
      floor_unit TEXT,
      type TEXT NOT NULL CHECK (type IN ('apartment_wg','house','studio','other')),
      total_size_sqm REAL,
      owner TEXT,
      hausverwaltung TEXT,
      mietspiegel_eur_per_sqm REAL,
      mietspiegel_updated_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      room_code TEXT NOT NULL,
      room_name TEXT,
      size_sqm REAL NOT NULL,
      base_kaltmiete REAL NOT NULL DEFAULT 0,
      utility_share REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'vacant'
        CHECK (status IN ('occupied','vacant','reserved','maintenance')),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (property_id, room_code)
    );
    CREATE INDEX IF NOT EXISTS idx_rooms_property ON rooms(property_id);
    CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);

    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      dob TEXT,
      nationality TEXT,
      employer TEXT,
      monthly_net_income REAL,
      id_doc_path TEXT,
      schufa_doc_path TEXT,
      payslip_paths_json TEXT,
      emergency_contact TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tenants_email ON tenants(email);
    CREATE INDEX IF NOT EXISTS idx_tenants_phone ON tenants(phone);

    CREATE TABLE IF NOT EXISTS tenancies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
      contract_type TEXT NOT NULL CHECK (contract_type IN ('standard','staffel','index')),
      start_date TEXT NOT NULL,
      end_date TEXT,
      kaltmiete REAL NOT NULL,
      nebenkosten REAL NOT NULL DEFAULT 0,
      warmmiete REAL NOT NULL,
      kaution REAL NOT NULL DEFAULT 0,
      kaution_received REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','active','ending','ended','cancelled')),
      contract_pdf_path TEXT,
      signed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tenancies_room ON tenancies(room_id);
    CREATE INDEX IF NOT EXISTS idx_tenancies_tenant ON tenancies(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tenancies_status ON tenancies(status);
    CREATE INDEX IF NOT EXISTS idx_tenancies_end_date ON tenancies(end_date);

    CREATE TABLE IF NOT EXISTS tenancy_rent_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenancy_id INTEGER NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
      effective_date TEXT NOT NULL,
      new_kaltmiete REAL NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('staffel','index','erhoehung')),
      reason TEXT,
      applied INTEGER NOT NULL DEFAULT 0,
      applied_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rent_steps_tenancy ON tenancy_rent_steps(tenancy_id);
    CREATE INDEX IF NOT EXISTS idx_rent_steps_effective ON tenancy_rent_steps(effective_date);

    CREATE TABLE IF NOT EXISTS rent_increases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenancy_id INTEGER NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
      current_kaltmiete REAL NOT NULL,
      proposed_kaltmiete REAL NOT NULL,
      increase_pct REAL NOT NULL,
      proposed_effective_date TEXT NOT NULL,
      legal_checks_json TEXT NOT NULL,
      mietspiegel_eur_per_sqm REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','sent','accepted','rejected','cancelled')),
      pdf_path TEXT,
      sent_at TEXT,
      responded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rent_increases_tenancy ON rent_increases(tenancy_id);

    CREATE TABLE IF NOT EXISTS sepa_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('camt053','mt940','csv')),
      bank_name TEXT,
      iban TEXT,
      total_credits REAL NOT NULL DEFAULT 0,
      tx_count INTEGER NOT NULL DEFAULT 0,
      raw_path TEXT,
      imported_by_user_id INTEGER NOT NULL,
      imported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sepa_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL REFERENCES sepa_imports(id) ON DELETE CASCADE,
      tx_date TEXT NOT NULL,
      amount REAL NOT NULL,
      counterparty_iban TEXT,
      counterparty_bic TEXT,
      counterparty_name TEXT,
      purpose TEXT,
      end_to_end_id TEXT,
      status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (status IN ('matched','partial','unmatched','manual_assigned','ignored')),
      matched_payment_id INTEGER,
      matched_by TEXT CHECK (matched_by IN ('auto_iban_amount','auto_iban_fuzzy','auto_purpose','manual')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sepa_tx_import ON sepa_transactions(import_id);
    CREATE INDEX IF NOT EXISTS idx_sepa_tx_iban ON sepa_transactions(counterparty_iban);
    CREATE INDEX IF NOT EXISTS idx_sepa_tx_status ON sepa_transactions(status);
    CREATE INDEX IF NOT EXISTS idx_sepa_tx_matched_payment ON sepa_transactions(matched_payment_id);

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenancy_id INTEGER NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
      expected_date TEXT NOT NULL,
      expected_amount REAL NOT NULL,
      received_amount REAL NOT NULL DEFAULT 0,
      received_date TEXT,
      sepa_tx_id INTEGER REFERENCES sepa_transactions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'expected'
        CHECK (status IN ('expected','matched','partial','missing','waived','carried','deducted_from_kaution')),
      shortfall REAL NOT NULL DEFAULT 0,
      resolution_note TEXT,
      resolved_by_user_id INTEGER,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenancy_id, expected_date)
    );
    CREATE INDEX IF NOT EXISTS idx_payments_tenancy ON payments(tenancy_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_payments_expected_date ON payments(expected_date);

    CREATE TABLE IF NOT EXISTS utility_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      category TEXT NOT NULL
        CHECK (category IN ('electricity','gas','water','internet','insurance','recycling','other')),
      provider_name TEXT NOT NULL,
      account_no TEXT,
      monthly_cost REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_utility_property ON utility_providers(property_id);

    CREATE TABLE IF NOT EXISTS inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenancy_id INTEGER NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('move_in','move_out')),
      inspection_date TEXT NOT NULL,
      inspector_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','in_progress','signed','archived')),
      tenant_signature_path TEXT,
      landlord_signature_path TEXT,
      tenant_signed_at TEXT,
      landlord_signed_at TEXT,
      pdf_path TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inspection_tenancy ON inspections(tenancy_id);
    CREATE INDEX IF NOT EXISTS idx_inspection_room ON inspections(room_id);
    CREATE INDEX IF NOT EXISTS idx_inspection_status ON inspections(status);

    CREATE TABLE IF NOT EXISTS meter_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      meter_type TEXT NOT NULL
        CHECK (meter_type IN ('electricity','gas','water_cold','water_hot','heating')),
      meter_no TEXT NOT NULL,
      reading_value REAL NOT NULL,
      reading_unit TEXT NOT NULL,
      reading_date TEXT NOT NULL,
      photo_path TEXT,
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','inspection')),
      inspection_id INTEGER REFERENCES inspections(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meter_property ON meter_readings(property_id);
    CREATE INDEX IF NOT EXISTS idx_meter_date ON meter_readings(reading_date);

    CREATE TABLE IF NOT EXISTS recycling_containers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      container_type TEXT NOT NULL
        CHECK (container_type IN ('restmuell','papier','bio','gelber_sack','glas','sondermuell')),
      size_liters INTEGER,
      company TEXT NOT NULL,
      pickup_day TEXT NOT NULL,
      frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','on_demand')),
      monthly_cost REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_recycling_property ON recycling_containers(property_id);

    CREATE TABLE IF NOT EXISTS credentials_vault (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      category TEXT NOT NULL,
      url TEXT,
      username_enc TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      notes_enc TEXT,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vault_property ON credentials_vault(property_id);

    CREATE TABLE IF NOT EXISTS credentials_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vault_id INTEGER REFERENCES credentials_vault(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('view','reveal','create','update','delete')),
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vault_audit_vault ON credentials_audit(vault_id);
    CREATE INDEX IF NOT EXISTS idx_vault_audit_user ON credentials_audit(user_id);
    CREATE INDEX IF NOT EXISTS idx_vault_audit_date ON credentials_audit(created_at);

    CREATE TABLE IF NOT EXISTS contract_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contract_type TEXT NOT NULL CHECK (contract_type IN ('standard','staffel','index')),
      file_path TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenancy_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES contract_templates(id) ON DELETE RESTRICT,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      prospect_name TEXT NOT NULL,
      prospect_email TEXT NOT NULL,
      prospect_phone TEXT,
      proposed_start_date TEXT NOT NULL,
      proposed_kaltmiete REAL NOT NULL,
      proposed_nebenkosten REAL NOT NULL DEFAULT 0,
      proposed_kaution REAL NOT NULL DEFAULT 0,
      contract_type TEXT NOT NULL CHECK (contract_type IN ('standard','staffel','index')),
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'sent'
        CHECK (status IN ('sent','opened','filled','signed','expired','cancelled')),
      form_data_json TEXT,
      tenant_signature_path TEXT,
      landlord_signature_path TEXT,
      contract_pdf_path TEXT,
      tenancy_id INTEGER REFERENCES tenancies(id) ON DELETE SET NULL,
      sent_at TEXT NOT NULL,
      opened_at TEXT,
      filled_at TEXT,
      signed_at TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invitation_token ON tenancy_invitations(token);
    CREATE INDEX IF NOT EXISTS idx_invitation_room ON tenancy_invitations(room_id);
    CREATE INDEX IF NOT EXISTS idx_invitation_status ON tenancy_invitations(status);

    CREATE TABLE IF NOT EXISTS inspection_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      item_label TEXT NOT NULL,
      condition TEXT CHECK (condition IN ('neuwertig','gut','gebrauchsspuren','beschaedigt')),
      notes TEXT,
      photo_paths_json TEXT NOT NULL DEFAULT '[]',
      item_order INTEGER NOT NULL DEFAULT 0,
      is_custom INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inspection_items_inspection ON inspection_items(inspection_id);
    CREATE INDEX IF NOT EXISTS idx_inspection_items_category ON inspection_items(category);

    CREATE TABLE IF NOT EXISTS property_inspection_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      item_label TEXT NOT NULL,
      item_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prop_insp_items_property ON property_inspection_items(property_id);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      tenancy_id INTEGER REFERENCES tenancies(id) ON DELETE CASCADE,
      property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
      room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
      due_date TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','dismissed','resolved')),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
    CREATE INDEX IF NOT EXISTS idx_alerts_tenancy ON alerts(tenancy_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_due_date ON alerts(due_date);

    CREATE TABLE IF NOT EXISTS room_furniture (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      condition TEXT CHECK (condition IN ('neuwertig','gut','gebrauchsspuren','beschaedigt')),
      checked INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      item_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_furniture_room ON room_furniture(room_id);
  `);

  // Migration: add furnished column to rooms
  const roomCols = d.prepare("PRAGMA table_info(rooms)").all() as { name: string }[];
  if (!roomCols.some(c => c.name === 'furnished')) {
    d.exec("ALTER TABLE rooms ADD COLUMN furnished INTEGER NOT NULL DEFAULT 0");
  }
}

export function closeRentalsDb() {
  if (db) {
    db.close();
    db = null;
  }
}
