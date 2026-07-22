/**
 * tasks-scope.ts — shared company-scope guard for task-manager mutation routes.
 *
 * Portal Odoo calls run as a single fixed sudo service account, so Odoo record
 * rules do NOT enforce tenancy — the Next.js route is the only company boundary.
 * The setup-photo routes already scope via assertScope; the sibling template-line
 * CRUD routes must use the same guard, else a per-company manager can mutate
 * another company's templates by guessing sequential IDs.
 */
import { AuthError, type PortalUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getTemplateCompany } from '@/lib/odoo-tasks';

/** Throw AuthError(403) unless the user may manage `templateId`'s company.
 *
 * ROLE-BASED (not empty-list-based): only an admin is unrestricted. A non-admin
 * manager must have the template's company in their allowed set — an empty set
 * means "no companies assigned" = DENY, NOT "all". (Template management is a
 * manager/admin config path; staff daily-toggle routes keep the app-wide
 * empty=all convention so unassigned staff aren't locked out.)
 * Fails CLOSED on a missing/company-less template too (and doesn't leak existence). */
export async function assertTemplateCompany(user: PortalUser, templateId: number): Promise<void> {
  if (user.role === 'admin') return;
  const allowed = parseCompanyIds(user.allowed_company_ids);
  const company = await getTemplateCompany(templateId);
  if (company === null || !allowed.includes(company)) throw new AuthError('Forbidden', 403);
}
