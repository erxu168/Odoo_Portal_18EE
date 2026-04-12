// src/lib/mieterhoehung.ts
// Mieterhöhung (rent increase) legal checks and calculations
// Krawings Portal · krawings_rentals v1.1.0
//
// German legal framework (simplified, Berlin-specific):
//
// 1. 15-Monats-Frist (§558 BGB)
//    - 12 months since last increase OR start of tenancy minimum
//    - New rent cannot take effect until month 15 after last increase
//
// 2. Kappungsgrenze (§558 Abs. 3 BGB) — Berlin 20% cap over 3 years
//    - Total increase over 36 months may not exceed 20% (15% in some regions,
//      Berlin uses 20% for Mietspiegel-regulated areas)
//
// 3. Mietpreisbremse (§556d BGB) — Berlin area is regulated
//    - New rent max = ortsübliche Vergleichsmiete + 10%
//
// 4. Mietspiegel reference
//    - Manual €/m² per property (stored on property record)
//    - Vergleichsmiete = size_sqm × mietspiegel_eur_per_sqm
//
// We only compute; we do not legally advise. The UI should display disclaimers.

import { getRentalsDb } from '@/lib/rentals-db';
import { Tenancy, Room, Property, TenancyRentStep } from '@/types/rentals';

export interface LegalCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface RentIncreaseAnalysis {
  tenancy_id: number;
  current_kaltmiete: number;
  size_sqm: number;
  mietspiegel_eur_per_sqm: number | null;
  vergleichsmiete: number | null;           // size × Mietspiegel
  max_kappung: number;                       // 20% / 3yr limit
  max_mietpreisbremse: number | null;        // Vergleichsmiete + 10%
  recommended_kaltmiete: number;             // smallest legal + sensible increase
  recommended_delta: number;
  recommended_delta_pct: number;
  earliest_effective_date: string;           // YYYY-MM-DD
  checks: LegalCheck[];
  blockers: string[];                        // if any, can't increase
}

export function analyzeRentIncrease(tenancyId: number): RentIncreaseAnalysis {
  const db = getRentalsDb();

  const tenancy = db.prepare(`SELECT * FROM tenancies WHERE id = ?`).get(tenancyId) as Tenancy | undefined;
  if (!tenancy) throw new Error('Tenancy not found');

  const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(tenancy.room_id) as Room;
  const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(room.property_id) as Property;

  const blockers: string[] = [];
  const checks: LegalCheck[] = [];

  // --- Check 1: 15-month lock ---
  const lastIncrease = db.prepare(`
    SELECT * FROM tenancy_rent_steps
    WHERE tenancy_id = ? AND type = 'erhoehung' AND applied = 1
    ORDER BY effective_date DESC LIMIT 1
  `).get(tenancyId) as TenancyRentStep | undefined;

  const lastIncreaseDate = lastIncrease ? lastIncrease.effective_date : tenancy.start_date;
  const monthsSince = monthsBetween(lastIncreaseDate, today());

  const passed15 = monthsSince >= 12;
  checks.push({
    key: 'frist_15',
    label: '15-Monats-Frist',
    passed: passed15,
    detail: passed15
      ? `Letzte Erhöhung vor ${monthsSince} Monaten (Zustimmung ab Monat 12, wirksam ab Monat 15)`
      : `Nur ${monthsSince} Monate seit letzter Erhöhung — Wartezeit nicht erfüllt`,
  });
  if (!passed15) blockers.push('15-Monats-Frist nicht erfüllt');

  // Earliest effective date = lastIncreaseDate + 15 months
  const earliest = addMonths(lastIncreaseDate, 15);
  const today_ = today();
  const earliestEffective = earliest > today_ ? earliest : firstOfNextMonth(today_);

  // --- Check 2: Kappungsgrenze (20% over 3 years, Berlin) ---
  // Find rent 36 months ago
  const threeYearsAgo = addMonths(today_, -36);
  const historic = db.prepare(`
    SELECT * FROM tenancy_rent_steps
    WHERE tenancy_id = ? AND effective_date <= ? AND applied = 1
    ORDER BY effective_date DESC LIMIT 1
  `).get(tenancyId, threeYearsAgo) as TenancyRentStep | undefined;

  const rent3yAgo = historic ? historic.new_kaltmiete : tenancy.kaltmiete;
  const maxKappung = Math.round(rent3yAgo * 1.2 * 100) / 100;
  const kappungOk = tenancy.kaltmiete < maxKappung;

  checks.push({
    key: 'kappung',
    label: 'Kappungsgrenze 20% / 3 Jahre (Berlin)',
    passed: kappungOk,
    detail: kappungOk
      ? `Max erlaubt: €${maxKappung.toFixed(2)} (aktuelle Miete €${tenancy.kaltmiete.toFixed(2)})`
      : `Obergrenze €${maxKappung.toFixed(2)} bereits erreicht`,
  });
  if (!kappungOk) blockers.push('Kappungsgrenze erreicht');

  // --- Check 3: Mietpreisbremse (cap = Vergleichsmiete + 10%) ---
  let vergleichsmiete: number | null = null;
  let maxBremse: number | null = null;
  if (property.mietspiegel_eur_per_sqm) {
    vergleichsmiete = Math.round(room.size_sqm * property.mietspiegel_eur_per_sqm * 100) / 100;
    maxBremse = Math.round(vergleichsmiete * 1.1 * 100) / 100;
    const bremseOk = tenancy.kaltmiete < maxBremse;
    checks.push({
      key: 'mietpreisbremse',
      label: 'Mietpreisbremse (Vergleichsmiete +10%)',
      passed: bremseOk,
      detail: bremseOk
        ? `Max €${maxBremse.toFixed(2)} (Vergleichsmiete €${vergleichsmiete.toFixed(2)} × 1,10)`
        : `Obergrenze €${maxBremse.toFixed(2)} überschritten`,
    });
  } else {
    checks.push({
      key: 'mietpreisbremse',
      label: 'Mietpreisbremse',
      passed: false,
      detail: 'Mietspiegel €/m² fehlt auf Immobilie — bitte eintragen',
    });
  }

  // --- Check 4: Mietspiegel comparison ---
  if (vergleichsmiete !== null) {
    checks.push({
      key: 'mietspiegel',
      label: 'Mietspiegel-Vergleich',
      passed: true,
      detail: `${room.size_sqm} m² × €${property.mietspiegel_eur_per_sqm!.toFixed(2)} = €${vergleichsmiete.toFixed(2)}`,
    });
  }

  // --- Recommended new rent: smallest of (kappung, bremse, vergleichsmiete) ---
  const caps: number[] = [maxKappung];
  if (maxBremse !== null) caps.push(maxBremse);
  const recommendedMax = Math.min(...caps);

  // If vergleichsmiete is higher than current rent, set recommended to min(vergleichsmiete, caps)
  // Otherwise keep current (nothing to raise to)
  let recommended = tenancy.kaltmiete;
  if (vergleichsmiete !== null && vergleichsmiete > tenancy.kaltmiete) {
    recommended = Math.min(vergleichsmiete, recommendedMax);
  } else if (maxKappung > tenancy.kaltmiete) {
    recommended = Math.min(maxKappung, recommendedMax);
  }
  recommended = Math.round(recommended * 100) / 100;

  const delta = Math.round((recommended - tenancy.kaltmiete) * 100) / 100;
  const deltaPct = tenancy.kaltmiete > 0
    ? Math.round((delta / tenancy.kaltmiete) * 1000) / 10
    : 0;

  return {
    tenancy_id: tenancyId,
    current_kaltmiete: tenancy.kaltmiete,
    size_sqm: room.size_sqm,
    mietspiegel_eur_per_sqm: property.mietspiegel_eur_per_sqm,
    vergleichsmiete,
    max_kappung: maxKappung,
    max_mietpreisbremse: maxBremse,
    recommended_kaltmiete: recommended,
    recommended_delta: delta,
    recommended_delta_pct: deltaPct,
    earliest_effective_date: earliestEffective,
    checks,
    blockers,
  };
}

// ============================================================================
// Date helpers
// ============================================================================

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function firstOfNextMonth(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return `${nextY}-${String(nextM).padStart(2, '0')}-01`;
}
