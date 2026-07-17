/**
 * station-auth.ts
 * PIN-only identification for the shared kitchen-tablet login.
 *
 * The tablet is signed in as a restricted "station" account (is_shared_device);
 * a person then types ONLY their 4-digit PIN and we resolve WHO they are among
 * the staff of the tablet's restaurant. The PIN never grants access beyond the
 * station account's own (kitchen-only) scope — it just says who is acting, so
 * task ticks and stock counts are credited to the right person.
 */

import { listStationCandidates, getUserById } from '@/lib/db';
import { verifyKioskPin } from '@/lib/shifts-db';

export type PinMatch =
  | { status: 'ok'; user: { id: number; name: string; employee_id: number | null } }
  | { status: 'none' }        // no staff in this company has that PIN
  | { status: 'ambiguous' };  // two+ staff share that PIN — must be fixed by a manager

/**
 * Match a 4-digit PIN against the company's employee-linked staff, verifying against
 * the canonical clock-in PIN store (shift_kiosk_pins), company-scoped. PIN-less
 * candidates cost only a cheap lookup (no hash). Ambiguity is surfaced, never guessed —
 * but two portal accounts on the SAME employee are one person, not a collision.
 */
export function findUserByPinInCompany(companyId: number, pin: string): PinMatch {
  const candidates = listStationCandidates(companyId); // active, non-shared, employee-linked, in this company
  const matches = candidates.filter(c => verifyKioskPin(companyId, c.employee_id, pin));
  if (matches.length === 0) return { status: 'none' };
  // Genuine ambiguity = two DIFFERENT employees share the PIN. Duplicate portal
  // accounts pointing at one employee_id are the same person, so don't count them.
  const distinctEmployees = new Set(matches.map(m => m.employee_id));
  if (distinctEmployees.size > 1) return { status: 'ambiguous' };
  const chosen = matches[0];
  const u = getUserById(chosen.id);
  return {
    status: 'ok',
    user: { id: chosen.id, name: chosen.name, employee_id: u?.employee_id ?? chosen.employee_id },
  };
}
