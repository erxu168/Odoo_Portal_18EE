/**
 * Server-side authorization for the Termination module.
 *
 * The dashboard tile is admin-by-default with per-user module grants
 * (e.g. the accountant), but tiles are not security. Every termination API
 * must enforce, server-side:
 *   1. at least the manager role,
 *   2. the 'termination' module granted to this user (same rule as the tile),
 *   3. for record routes: the record's company is in the user's allowed set
 *      (portal Odoo calls run as a shared service account, so record-level
 *      company scoping MUST happen here).
 */
import { requireRole, AuthError, type PortalUser } from '@/lib/auth';
import { effectiveModuleIds } from '@/lib/modules';
import { canAccessCompany, companyScope } from '@/lib/inventory-access';
import { getOdoo } from '@/lib/odoo';

export async function requireTerminationAccess(recordId?: number): Promise<PortalUser> {
  const user = requireRole('manager');
  if (!effectiveModuleIds(user.role, user.module_access).includes('termination')) {
    throw new AuthError('Forbidden', 403);
  }
  if (recordId != null) {
    if (!Number.isInteger(recordId) || recordId <= 0) throw new AuthError('Not found', 404);
    const rows = await getOdoo().read('kw.termination', [recordId], ['company_id']);
    const rec = rows?.[0];
    if (!rec) throw new AuthError('Not found', 404);
    const cid = Array.isArray(rec.company_id) ? rec.company_id[0] : rec.company_id;
    if (!canAccessCompany(user, cid)) throw new AuthError('Forbidden', 403);
  }
  return user;
}

/** Company ids to filter LIST queries by, or undefined for unrestricted admins. */
export function terminationCompanyScope(user: PortalUser): number[] | undefined {
  return companyScope(user);
}
