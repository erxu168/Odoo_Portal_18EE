/**
 * Who may open / count / update a counting session.
 *
 * The single source of truth for staff authorization on a session, used by the
 * session list, the guided-route GET, and the per-stop location-status write so
 * they can never drift apart.
 *
 * Rules:
 *  - managers / admins: any session.
 *  - a session assigned to a specific person: only that person.
 *  - a session NOT assigned to a person ("Anyone" / department / shift): any
 *    staff member of that session's restaurant (company). This is what lets a
 *    shared department tablet — one company-scoped staff account — see and run
 *    the daily list without per-person assignment.
 */
import { hasRole } from '@/lib/auth';
import { parseCompanyIds, type PortalUser } from '@/lib/db';
import type { CountingSession } from '@/types/inventory';

export function canAccessSession(user: PortalUser, session: CountingSession): boolean {
  if (hasRole(user, 'manager')) return true;
  if (session.assigned_user_id != null) return session.assigned_user_id === user.id;
  // Unassigned-to-a-person → visible to staff of the session's company.
  // A null company (legacy list, pre-dating this feature) stays person-only.
  const company = session.company_id ?? null;
  if (company == null) return false;
  return parseCompanyIds(user.allowed_company_ids).includes(company);
}
