// scripts/seed-rentals.ts
// Populate the rentals DB with demo data for staging / clicking through the UI.
// Run with: npx tsx scripts/seed-rentals.ts
//
// Creates:
//   - 3 properties (KD 38, WS 72, NK 14)
//   - 11 rooms across them
//   - 5 tenants
//   - 5 active tenancies (standard, staffel, index mix)
//   - Utility providers + meter readings + recycling containers per property
//   - 2 months of expected payments, some matched, one partial, one missing
//   - 1 pending rent-increase eligible case
//   - 1 vault credential per property (requires KRAWINGS_VAULT_KEY)
//   - 1 draft move-in inspection
//
// Safe to re-run: it wipes and re-seeds.

import { getRentalsDb, berlinNow, berlinToday, closeRentalsDb } from '../src/lib/rentals-db';
import { createCredential } from '../src/lib/vault';
import { runAlertsEngine } from '../src/lib/alerts-engine';

const now = berlinNow();
const today = berlinToday();

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function firstOfMonth(offsetMonths = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().slice(0, 10);
}

function wipe() {
  const db = getRentalsDb();
  db.exec(`
    DELETE FROM credentials_audit;
    DELETE FROM credentials_vault;
    DELETE FROM inspection_items;
    DELETE FROM inspections;
    DELETE FROM property_inspection_items;
    DELETE FROM alerts;
    DELETE FROM sepa_transactions;
    DELETE FROM sepa_imports;
    DELETE FROM payments;
    DELETE FROM rent_increases;
    DELETE FROM tenancy_rent_steps;
    DELETE FROM tenancy_invitations;
    DELETE FROM contract_templates;
    DELETE FROM tenancies;
    DELETE FROM tenants;
    DELETE FROM meter_readings;
    DELETE FROM recycling_containers;
    DELETE FROM utility_providers;
    DELETE FROM rooms;
    DELETE FROM properties;
  `);
}

function seed() {
  const db = getRentalsDb();

  console.log('==> Wiping existing data...');
  wipe();

  console.log('==> Creating properties...');
  const propIds: number[] = [];

  const insertProp = db.prepare(`
    INSERT INTO properties
    (street, plz, city, floor_unit, type, total_size_sqm, owner, hausverwaltung,
     mietspiegel_eur_per_sqm, mietspiegel_updated_at, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  propIds.push(Number(insertProp.run(
    'Kottbusser Damm 38', '10999', 'Berlin', '4. OG, Wohnung 12', 'apartment_wg',
    118, 'Krawings GmbH', 'Hausverwaltung Müller', 14.20, today, null, now, now
  ).lastInsertRowid));

  propIds.push(Number(insertProp.run(
    'Warschauer Straße 72', '10243', 'Berlin', '2. OG links', 'apartment_wg',
    135, 'Krawings GmbH', 'Immobilien Berlin GmbH', 15.80, today, null, now, now
  ).lastInsertRowid));

  propIds.push(Number(insertProp.run(
    'Neuköllner Straße 14', '12043', 'Berlin', 'EG rechts', 'apartment_wg',
    72, 'Krawings GmbH', null, 12.50, today, null, now, now
  ).lastInsertRowid));

  console.log('==> Creating rooms...');
  const insertRoom = db.prepare(`
    INSERT INTO rooms (property_id, room_code, room_name, size_sqm, base_kaltmiete, utility_share, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const roomIds: number[] = [];
  // KD 38 — 4 rooms
  roomIds.push(Number(insertRoom.run(propIds[0], 'A', 'Park View', 18, 650, 130, 'occupied', now, now).lastInsertRowid));
  roomIds.push(Number(insertRoom.run(propIds[0], 'B', 'Courtyard', 14, 520, 130, 'occupied', now, now).lastInsertRowid));
  roomIds.push(Number(insertRoom.run(propIds[0], 'C', 'Balcony', 16, 600, 130, 'occupied', now, now).lastInsertRowid));
  roomIds.push(Number(insertRoom.run(propIds[0], 'D', 'Studio', 22, 720, 130, 'occupied', now, now).lastInsertRowid));
  // WS 72 — 5 rooms
  roomIds.push(Number(insertRoom.run(propIds[1], '1', 'Spree', 20, 700, 140, 'occupied', now, now).lastInsertRowid));
  roomIds.push(Number(insertRoom.run(propIds[1], '2', 'Garten', 15, 580, 140, 'vacant', now, now).lastInsertRowid));
  roomIds.push(Number(insertRoom.run(propIds[1], '3', 'Straße', 18, 640, 140, 'vacant', now, now).lastInsertRowid));
  roomIds.push(Number(insertRoom.run(propIds[1], '4', 'Eck', 17, 620, 140, 'vacant', now, now).lastInsertRowid));
  roomIds.push(Number(insertRoom.run(propIds[1], '5', 'Atelier', 25, 820, 140, 'vacant', now, now).lastInsertRowid));
  // NK 14 — 2 rooms
  roomIds.push(Number(insertRoom.run(propIds[2], 'A', 'Sonne', 16, 540, 120, 'occupied', now, now).lastInsertRowid));
  roomIds.push(Number(insertRoom.run(propIds[2], 'B', 'Schatten', 14, 480, 120, 'vacant', now, now).lastInsertRowid));

  console.log('==> Creating tenants...');
  const insertTenant = db.prepare(`
    INSERT INTO tenants (full_name, email, phone, dob, nationality, employer, monthly_net_income, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tenantIds: number[] = [];
  tenantIds.push(Number(insertTenant.run('Maria Schröder', 'maria.s@email.de', '+49 171 1234567', '1990-05-12', 'Deutsch', 'Zalando SE', 2800, now, now).lastInsertRowid));
  tenantIds.push(Number(insertTenant.run('Lukas Meier', 'lukas.m@email.de', '+49 172 2345678', '1988-11-23', 'Deutsch', 'BVG', 2400, now, now).lastInsertRowid));
  tenantIds.push(Number(insertTenant.run('Sofia Romano', 'sofia.r@email.com', '+49 176 3456789', '1995-08-14', 'Italienisch', 'Freelance', 2100, now, now).lastInsertRowid));
  tenantIds.push(Number(insertTenant.run('Jonas Kaiser', 'jonas.k@email.de', '+49 151 4567890', '1985-02-08', 'Deutsch', 'Siemens', 3400, now, now).lastInsertRowid));
  tenantIds.push(Number(insertTenant.run('Anna Hoffmann', 'anna.h@email.de', '+49 173 5678901', '1992-09-19', 'Deutsch', 'Charité', 2900, now, now).lastInsertRowid));

  console.log('==> Creating tenancies...');
  const insertTenancy = db.prepare(`
    INSERT INTO tenancies
    (room_id, tenant_id, contract_type, start_date, end_date,
     kaltmiete, nebenkosten, warmmiete, kaution, kaution_received,
     status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tenancyIds: number[] = [];
  // Maria — standard, 2 years in, eligible for rent increase
  tenancyIds.push(Number(insertTenancy.run(
    roomIds[0], tenantIds[0], 'standard', monthsAgo(25), null,
    650, 130, 780, 1950, 1950, 'active', now, now
  ).lastInsertRowid));
  // Lukas — staffelmiete
  tenancyIds.push(Number(insertTenancy.run(
    roomIds[1], tenantIds[1], 'staffel', monthsAgo(14), null,
    520, 130, 650, 1560, 1560, 'active', now, now
  ).lastInsertRowid));
  // Sofia — standard, contract ending in 30 days
  {
    const endDate = new Date(); endDate.setDate(endDate.getDate() + 30);
    tenancyIds.push(Number(insertTenancy.run(
      roomIds[2], tenantIds[2], 'standard', monthsAgo(23), endDate.toISOString().slice(0, 10),
      600, 130, 730, 1800, 1800, 'active', now, now
    ).lastInsertRowid));
  }
  // Jonas — long term standard
  tenancyIds.push(Number(insertTenancy.run(
    roomIds[3], tenantIds[3], 'standard', monthsAgo(38), null,
    720, 130, 850, 2160, 2160, 'active', now, now
  ).lastInsertRowid));
  // Anna — indexmiete at WS 72 room 1
  tenancyIds.push(Number(insertTenancy.run(
    roomIds[4], tenantIds[4], 'index', monthsAgo(19), null,
    700, 140, 840, 2100, 2100, 'active', now, now
  ).lastInsertRowid));

  // Add a Staffelmiete step for Lukas
  db.prepare(`
    INSERT INTO tenancy_rent_steps (tenancy_id, effective_date, new_kaltmiete, type, applied, created_at)
    VALUES (?, ?, ?, 'staffel', 0, ?)
  `).run(tenancyIds[1], firstOfMonth(1), 545, now);

  console.log('==> Creating utility providers...');
  const insertUtil = db.prepare(`
    INSERT INTO utility_providers (property_id, category, provider_name, account_no, monthly_cost, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const pid of propIds) {
    insertUtil.run(pid, 'electricity', 'Vattenfall', 'V-' + Math.floor(Math.random() * 1000000), 142, now, now);
    insertUtil.run(pid, 'gas', 'GASAG', 'G-' + Math.floor(Math.random() * 1000000), 98, now, now);
    insertUtil.run(pid, 'water', 'BWB', 'W-' + Math.floor(Math.random() * 1000000), 58, now, now);
    insertUtil.run(pid, 'internet', 'o2 DSL', 'O2-' + Math.floor(Math.random() * 1000000), 35, now, now);
    insertUtil.run(pid, 'insurance', 'Allianz Haftpflicht', 'H-' + Math.floor(Math.random() * 1000000), 42, now, now);
  }

  console.log('==> Creating meter readings...');
  const insertMeter = db.prepare(`
    INSERT INTO meter_readings
    (property_id, meter_type, meter_no, reading_value, reading_unit, reading_date, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)
  `);
  for (const pid of propIds) {
    insertMeter.run(pid, 'electricity', '0482-731', 14820 + Math.random() * 100, 'kWh', today, now);
    insertMeter.run(pid, 'gas', 'G-3391-008', 8240 + Math.random() * 50, 'm³', today, now);
    insertMeter.run(pid, 'water_cold', 'W-118-442', 284 + Math.random() * 10, 'm³', today, now);
  }

  console.log('==> Creating recycling containers...');
  const insertRecycle = db.prepare(`
    INSERT INTO recycling_containers
    (property_id, container_type, size_liters, company, pickup_day, frequency, monthly_cost, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const pid of propIds) {
    insertRecycle.run(pid, 'restmuell', 240, 'BSR', 'Mon', 'weekly', 28, now, now);
    insertRecycle.run(pid, 'papier', 240, 'BSR', 'Wed', 'biweekly', 12, now, now);
    insertRecycle.run(pid, 'bio', 120, 'BSR', 'Thu', 'weekly', 18, now, now);
    insertRecycle.run(pid, 'gelber_sack', null, 'ALBA', 'Fri', 'biweekly', 10, now, now);
  }

  console.log('==> Creating payments (2 months)...');
  const insertPayment = db.prepare(`
    INSERT INTO payments
    (tenancy_id, expected_date, expected_amount, received_amount, received_date, status, shortfall, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Last month — all matched except Sofia (partial) and Jonas (missing)
  const lastMonth = firstOfMonth(-1);
  const thisMonth = firstOfMonth(0);

  insertPayment.run(tenancyIds[0], lastMonth, 780, 780, lastMonth, 'matched', 0, now, now);
  insertPayment.run(tenancyIds[1], lastMonth, 650, 650, lastMonth, 'matched', 0, now, now);
  insertPayment.run(tenancyIds[2], lastMonth, 730, 650, lastMonth, 'partial', 80, now, now);
  insertPayment.run(tenancyIds[3], lastMonth, 850, 0, null, 'missing', 850, now, now);
  insertPayment.run(tenancyIds[4], lastMonth, 840, 840, lastMonth, 'matched', 0, now, now);

  // This month — all expected
  insertPayment.run(tenancyIds[0], thisMonth, 780, 0, null, 'expected', 0, now, now);
  insertPayment.run(tenancyIds[1], thisMonth, 650, 0, null, 'expected', 0, now, now);
  insertPayment.run(tenancyIds[2], thisMonth, 730, 0, null, 'expected', 0, now, now);
  insertPayment.run(tenancyIds[3], thisMonth, 850, 0, null, 'expected', 0, now, now);
  insertPayment.run(tenancyIds[4], thisMonth, 840, 0, null, 'expected', 0, now, now);

  console.log('==> Creating contract template...');
  db.prepare(`
    INSERT INTO contract_templates (name, contract_type, file_path, fields_json, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(
    'Standard WG Mietvertrag (DE)',
    'standard',
    'data/templates/standard_wg.html',
    JSON.stringify({
      fields: [
        { key: 'tenant_name', label: 'Vollständiger Name', type: 'string', required: true },
        { key: 'dob', label: 'Geburtsdatum', type: 'date', required: true },
        { key: 'kaltmiete', label: 'Kaltmiete', type: 'currency', required: true },
        { key: 'nebenkosten', label: 'Nebenkosten', type: 'currency', required: true },
        { key: 'kaution', label: 'Kaution', type: 'currency', required: true },
        { key: 'start_date', label: 'Mietbeginn', type: 'date', required: true },
        { key: 'room_code', label: 'Zimmer', type: 'string', required: true },
      ],
    }),
    now, now
  );

  console.log('==> Creating vault credentials...');
  if (process.env.KRAWINGS_VAULT_KEY) {
    createCredential(
      {
        property_id: propIds[0],
        label: 'Vattenfall Portal',
        category: 'electricity',
        url: 'https://portal.vattenfall.de',
        username: 'rechnungen@krawings.de',
        password: 'DemoSeedPass123!',
        notes: 'Demo seed data — rotate before production',
      },
      1, '127.0.0.1', 'seed-script'
    );
    createCredential(
      {
        property_id: propIds[0],
        label: 'GASAG Kundenportal',
        category: 'gas',
        url: 'https://meine.gasag.de',
        username: 'e.kreuzberg',
        password: 'DemoSeedPass456!',
        notes: null,
      },
      1, '127.0.0.1', 'seed-script'
    );
  } else {
    console.log('    (skipped — KRAWINGS_VAULT_KEY not set)');
  }

  console.log('==> Running alerts engine...');
  const alertResult = runAlertsEngine();
  console.log('    alerts:', alertResult);

  console.log('');
  console.log('✓ Seed complete.');
  console.log(`  ${propIds.length} properties · ${roomIds.length} rooms · ${tenantIds.length} tenants`);
  console.log(`  ${tenancyIds.length} active tenancies · 10 payments · ${alertResult.created} alerts`);
}

try {
  seed();
} catch (err) {
  console.error('Seed failed:', err);
  process.exit(1);
} finally {
  closeRentalsDb();
}
