/**
 * company-scope.ts — one place to decide whether a portal user may act within a
 * given company for the guide-library routes.
 *
 * Rule (fail CLOSED): an admin is unrestricted; everyone else must have a
 * NON-EMPTY company scope that includes the target company. An empty or
 * malformed allowed_company_ids therefore DENIES — it must never fall through to
 * "no filter", which would let a mis-scoped manager/staff reach any company.
 */

import type { PortalUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

export function userCompanyAllowed(user: PortalUser, company: number | null): boolean {
  if (user.role === 'admin') return true;
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (!allowed.length) return false;
  return company !== null && allowed.includes(company);
}
