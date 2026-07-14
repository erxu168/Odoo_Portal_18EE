// src/lib/alerts-engine.ts
// Scans the DB for conditions worth surfacing and upserts rows into `alerts`.
// Run as a cron, or on-demand. Idempotent by (type, tenancy_id, due_date).
//
// Alert types generated:
//   - contract_ending_90 / _60 / _30
//   - rent_increase_eligible  (>= 12 months since last increase, not blocked)
//   - staffel_step_due        (a Staffelmiete step is <= 30 days away)
//   - payment_overdue         (status = missing or partial > 7 days)

import { getRentalsDb, berlinNow, berlinToday } from '@/lib/rentals-db';
import { Tenancy, TenancyRentStep, Payment, AlertType } from '@/types/rentals';

export interface AlertGenResult {
  created: number;
  refreshed: number;
  resolved: number;
}

export function runAlertsEngine(): AlertGenResult {
  const db = getRentalsDb();
  const now = berlinNow();
  const today = berlinToday();

  let created = 0;
  let refreshed = 0;
  let resolved = 0;

  // Upsert helper (unique on type + tenancy_id + due_date)
  const upsert = db.prepare(`
    INSERT INTO alerts
      (type, tenancy_id, property_id, room_id, due_date, title, body, payload_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    ON CONFLICT DO NOTHING
  `);

  const hasAlert = db.prepare(`
    SELECT id FROM alerts
    WHERE type = ? AND COALESCE(tenancy_id, 0) = COALESCE(?, 0)
      AND COALESCE(due_date, '') = COALESCE(?, '')
      AND status = 'active'
  `);

  // ---- 1. Contract ending: 30, 60, 90 days ----
  const ending = db.prepare(`
    SELECT t.*, r.property_id, r.room_code, tn.full_name AS tenant_name
    FROM tenancies t
    JOIN rooms r ON r.id = t.room_id
    JOIN tenants tn ON tn.id = t.tenant_id
    WHERE t.status IN ('active', 'ending')
      AND t.end_date IS NOT NULL
      AND date(t.end_date) BETWEEN date(?) AND date(?, '+90 days')
  `).all(today, today) as (Tenancy & { property_id: number; room_code: string; tenant_name: string })[];

  for (const t of ending) {
    if (!t.end_date) continue;
    const daysOut = daysBetween(today, t.end_date);

    let window: 30 | 60 | 90 | null = null;
    if (daysOut <= 30) window = 30;
    else if (daysOut <= 60) window = 60;
    else if (daysOut <= 90) window = 90;
    if (!window) continue;

    const type: AlertType = `contract_ending_${window}` as AlertType;
    const title = `Vertrag endet in ${daysOut} Tagen · ${t.tenant_name}`;
    const body = `Zimmer ${t.room_code} · Vertragsende ${t.end_date}. Verlängerung oder Auszug klären.`;

    const existing = hasAlert.get(type, t.id, t.end_date);
    if (existing) { refreshed++; continue; }
    upsert.run(type, t.id, t.property_id, t.room_id, t.end_date, title, body, null, now);
    created++;
  }

  // ---- 2. Rent increase eligible ----
  const activeTenancies = db.prepare(`
    SELECT t.*, r.property_id, r.room_code, tn.full_name AS tenant_name
    FROM tenancies t
    JOIN rooms r ON r.id = t.room_id
    JOIN tenants tn ON tn.id = t.tenant_id
    WHERE t.status = 'active'
  `).all() as (Tenancy & { property_id: number; room_code: string; tenant_name: string })[];

  for (const t of activeTenancies) {
    const lastInc = db.prepare(`
      SELECT * FROM tenancy_rent_steps
      WHERE tenancy_id = ? AND type = 'erhoehung' AND applied = 1
      ORDER BY effective_date DESC LIMIT 1
    `).get(t.id) as TenancyRentStep | undefined;

    const lastDate = lastInc ? lastInc.effective_date : t.start_date;
    const months = monthsBetween(lastDate, today);
    if (months < 12) continue;

    const type: AlertType = 'rent_increase_eligible';
    const title = `Mieterhöhung möglich · ${t.tenant_name}`;
    const body = `Zimmer ${t.room_code} · Letzte Änderung vor ${months} Monaten. Wizard starten.`;

    const existing = hasAlert.get(type, t.id, null);
    if (existing) { refreshed++; continue; }
    upsert.run(type, t.id, t.property_id, t.room_id, null, title, body, null, now);
    created++;
  }

  // ---- 3. Staffelmiete step due in next 30 days ----
  const upcomingSteps = db.prepare(`
    SELECT s.*, t.room_id, r.property_id, r.room_code, tn.full_name AS tenant_name
    FROM tenancy_rent_steps s
    JOIN tenancies t ON t.id = s.tenancy_id
    JOIN rooms r ON r.id = t.room_id
    JOIN tenants tn ON tn.id = t.tenant_id
    WHERE s.type = 'staffel' AND s.applied = 0
      AND date(s.effective_date) BETWEEN date(?) AND date(?, '+30 days')
  `).all(today, today) as (TenancyRentStep & {
    room_id: number; property_id: number; room_code: string; tenant_name: string;
  })[];

  for (const s of upcomingSteps) {
    const type: AlertType = 'staffel_step_due';
    const title = `Staffelmiete-Stufe fällig · ${s.tenant_name}`;
    const body = `Zimmer ${s.room_code} · Neue Miete €${s.new_kaltmiete} ab ${s.effective_date}`;

    const existing = hasAlert.get(type, s.tenancy_id, s.effective_date);
    if (existing) { refreshed++; continue; }
    upsert.run(type, s.tenancy_id, s.property_id, s.room_id, s.effective_date, title, body, null, now);
    created++;
  }

  // ---- 4. Payment overdue (missing, or partial > 7 days) ----
  const overduePayments = db.prepare(`
    SELECT p.*, t.room_id, r.property_id, r.room_code, tn.full_name AS tenant_name
    FROM payments p
    JOIN tenancies t ON t.id = p.tenancy_id
    JOIN rooms r ON r.id = t.room_id
    JOIN tenants tn ON tn.id = t.tenant_id
    WHERE (p.status = 'missing' OR (p.status = 'partial' AND date(p.expected_date) <= date(?, '-7 days')))
  `).all(today) as (Payment & { room_id: number; property_id: number; room_code: string; tenant_name: string })[];

  for (const p of overduePayments) {
    const type: AlertType = 'payment_overdue';
    const title = `Zahlung überfällig · ${p.tenant_name}`;
    const shortfall = p.shortfall > 0 ? ` · Fehlbetrag €${p.shortfall}` : '';
    const body = `Zimmer ${p.room_code} · ${p.expected_date}${shortfall}`;

    const existing = hasAlert.get(type, p.tenancy_id, p.expected_date);
    if (existing) { refreshed++; continue; }
    upsert.run(type, p.tenancy_id, p.property_id, p.room_id, p.expected_date, title, body, null, now);
    created++;
  }

  // ---- Resolve stale alerts: tenancies ended, payments matched, etc ----
  const stale = db.prepare(`
    UPDATE alerts SET status = 'resolved', resolved_at = ?
    WHERE status = 'active' AND (
      (type LIKE 'contract_ending%' AND tenancy_id IN (
        SELECT id FROM tenancies WHERE status IN ('ended', 'cancelled')
      ))
      OR
      (type = 'payment_overdue' AND tenancy_id IN (
        SELECT tenancy_id FROM payments WHERE status IN ('matched', 'waived', 'deducted_from_kaution')
        AND expected_date = alerts.due_date
      ))
      OR
      (type = 'staffel_step_due' AND tenancy_id IN (
        SELECT tenancy_id FROM tenancy_rent_steps WHERE effective_date = alerts.due_date AND applied = 1
      ))
    )
  `).run(now);
  resolved = stale.changes;

  return { created, refreshed, resolved };
}

// ============================================================================

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = fromIso.split('-').map(Number);
  const [ty, tm] = toIso.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
