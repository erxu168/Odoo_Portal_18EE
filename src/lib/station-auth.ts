/**
 * station-auth.ts
 * Name-then-PIN identification for the shared kitchen tablet.
 *
 * The tablet is signed in as a restricted "station" account (is_shared_device).
 * A person first taps THEIR NAME, then enters their 4-digit PIN; we verify that
 * one selected person's PIN against the canonical clock-in store (shift_kiosk_pins).
 * The PIN never grants access beyond the station account's own (kitchen-only)
 * scope — it only says who is acting, so task ticks and stock counts are credited
 * to the right person. Because the NAME identifies the person (no reverse-by-PIN
 * lookup), two staff may safely share a PIN with no ambiguity.
 */

import { getUserById, parseCompanyIds } from '@/lib/db';
import { verifyKioskPin } from '@/lib/shifts-db';

export type PersonPinResult =
  | { status: 'ok'; user: { id: number; name: string; employee_id: number } }
  | { status: 'invalid' }     // not a valid person for this restaurant
  | { status: 'wrong_pin' };  // the person exists but the PIN was wrong

/**
 * Verify a SELECTED person's PIN for a restaurant. The caller says who they claim
 * to be (userId, chosen from the name picker); we confirm the account is a real,
 * active, non-shared, employee-linked member of that company, then check the PIN
 * against the canonical clock-in store. Callers MUST treat 'invalid' and
 * 'wrong_pin' identically (one generic error) so a crafted id can't be used to
 * probe account state or PIN validity.
 */
export function verifyStationPersonPin(companyId: number, userId: number, pin: string): PersonPinResult {
  const u = getUserById(userId);
  // Revocation-safe: a deactivated/suspended, shared-device or employee-unlinked
  // account can never be identified by PIN, even if a clock PIN was left behind.
  if (!u || !u.employee_id || !u.active || u.status !== 'active' || u.is_shared_device) {
    return { status: 'invalid' };
  }
  // The person must belong to this restaurant (admins are cross-company).
  if (u.role !== 'admin' && !parseCompanyIds(u.allowed_company_ids).includes(companyId)) {
    return { status: 'invalid' };
  }
  if (!verifyKioskPin(companyId, u.employee_id, pin)) {
    return { status: 'wrong_pin' };
  }
  return { status: 'ok', user: { id: u.id, name: u.name, employee_id: u.employee_id } };
}
