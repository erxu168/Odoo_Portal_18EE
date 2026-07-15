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

import { listShiftStaff, verifyUserPin, getUserById } from '@/lib/db';

export type PinMatch =
  | { status: 'ok'; user: { id: number; name: string; employee_id: number | null } }
  | { status: 'none' }        // no staff in this company has that PIN
  | { status: 'ambiguous' };  // two+ staff share that PIN — must be fixed by a manager

/**
 * Match a 4-digit PIN against the company's pinned staff. Iterates candidates and
 * bcrypt-compares (staff counts are small). Ambiguity is surfaced, never guessed.
 */
export function findUserByPinInCompany(companyId: number, pin: string): PinMatch {
  const candidates = listShiftStaff(companyId); // active, non-shared, has a PIN, in this company
  const matches = candidates.filter(c => verifyUserPin(c.id, pin));
  if (matches.length === 0) return { status: 'none' };
  if (matches.length > 1) return { status: 'ambiguous' };
  const u = getUserById(matches[0].id);
  return {
    status: 'ok',
    user: { id: matches[0].id, name: matches[0].name, employee_id: u?.employee_id ?? null },
  };
}
