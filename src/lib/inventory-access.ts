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

/**
 * True only for a full admin with NO company restriction — sees every company.
 * "No restriction" means the allowed list is genuinely unset or a canonical empty
 * array. A PRESENT-but-malformed value (bad JSON, string ids, etc.) is treated as
 * a restriction and denied — never silently read as "all companies" (fail closed).
 */
export function isUnrestrictedAdmin(user: PortalUser): boolean {
  if (user.role !== 'admin') return false;
  const raw = user.allowed_company_ids;
  if (raw == null || String(raw).trim() === '') return true; // genuinely unset
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length === 0; // canonical empty array only
  } catch {
    return false; // malformed → restricted
  }
}

/** A usable Odoo company id is a positive integer; anything else is denied. */
function isValidCompanyId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

/**
 * May this user act on records belonging to `companyId`? An unrestricted admin
 * may touch any company; everyone else only the companies in their allowed list.
 * An EMPTY allowed list therefore means NO access for a non-admin — never "all"
 * (the opposite of the old per-route `allows()` helper, which handed god-mode to
 * any misconfigured empty-company manager). Invalid ids are always denied.
 */
export function canAccessCompany(user: PortalUser, companyId: number): boolean {
  if (!isValidCompanyId(companyId)) return false;
  if (isUnrestrictedAdmin(user)) return true;
  return parseCompanyIds(user.allowed_company_ids).includes(companyId);
}

/**
 * Pick the single company a one-company-at-a-time endpoint should act on:
 *  - a requested company is honoured only when it is valid AND the caller may
 *    access it, else null (the route then denies rather than silently retargeting);
 *  - with nothing requested (null), a non-admin defaults to their first allowed
 *    company (null when they have none) and an unrestricted admin must ask
 *    explicitly (null — these endpoints act on one company at a time).
 */
export function resolveScopedCompany(user: PortalUser, requested: number | null): number | null {
  if (requested !== null) return canAccessCompany(user, requested) ? requested : null;
  if (isUnrestrictedAdmin(user)) return null;
  const allowed = parseCompanyIds(user.allowed_company_ids);
  return allowed.length > 0 ? allowed[0] : null;
}

/**
 * The companies a user is scoped to for LISTING queries, or `undefined` when the
 * user is an unrestricted admin (apply no company filter). A non-admin's scope is
 * exactly their allowed_company_ids — possibly `[]`, which must mean "see nothing".
 */
export function companyScope(user: PortalUser): number[] | undefined {
  if (isUnrestrictedAdmin(user)) return undefined;
  return parseCompanyIds(user.allowed_company_ids);
}
