export const dynamic = 'force-dynamic';
/**
 * GET /api/cron/closing-report-missing?token=<CRON_SECRET>
 *
 * For every company with the Closing Report morning email ON: after 08:00
 * Berlin, look at LAST NIGHT (the just-locked night), and if any participating
 * department (= has at least one active question) has no report, email the
 * company's managers ONE list of the missing departments. Claimed atomically
 * per company+night so a double-run can't double-send. Run hourly:
 *
 *   10 * * * * curl -s "http://localhost:3000/api/cron/closing-report-missing?token=$CRON_SECRET"
 */
import { NextResponse } from 'next/server';
import { getDb, getRoleModuleOverrides, parseCompanyIds, type PortalUser } from '@/lib/db';
import { isUnrestrictedAdmin } from '@/lib/inventory-access';
import { effectiveModuleIds } from '@/lib/modules';
import { fetchDepartments } from '@/lib/shifts-odoo';
import { sendClosingReportMissingEmail } from '@/lib/email';
import {
  companiesWithMissingEmail, claimMissingEmail, departmentIdsWithQuestions,
  initClosingTables, listReportsForDate, releaseMissingEmailClaim,
} from '@/lib/closing-report/db';
import { closingOperationalDate, shiftDay } from '@/lib/closing-report/night';

const SEND_HOUR_BERLIN = 8;

function berlinHourNow(): number {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' })).getHours();
}

interface RecipientRow {
  id: number; name: string; email: string | null; role: string;
  allowed_company_ids: string | null; module_access: string | null;
  is_shared_device: number | null;
}

/** Company-restricted like the shared access helpers: an admin with a company
 *  list is scoped to it; only a genuinely unrestricted admin passes everywhere
 *  (isUnrestrictedAdmin fails CLOSED on a malformed company list). */
function userCoversCompany(r: RecipientRow, companyId: number): boolean {
  if (parseCompanyIds(r.allowed_company_ids).includes(companyId)) return true;
  return isUnrestrictedAdmin(r as unknown as PortalUser);
}

/** Active manager/admin humans of this company who can actually open the module. */
function recipientsForCompany(companyId: number): { name: string; email: string }[] {
  const rows = getDb().prepare(
    "SELECT id, name, email, role, allowed_company_ids, module_access, is_shared_device FROM portal_users WHERE active = 1 AND status = 'active' AND role IN ('manager','admin')",
  ).all() as RecipientRow[];
  const overrides = getRoleModuleOverrides();
  return rows
    .filter((r) => !r.is_shared_device)
    .filter((r) => userCoversCompany(r, companyId))
    .filter((r) => effectiveModuleIds(r.role, r.module_access, overrides).includes('closing-report'))
    .filter((r): r is RecipientRow & { email: string } => !!r.email && r.email.includes('@'))
    .map((r) => ({ name: r.name, email: r.email }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const secret = process.env.CRON_SECRET;
  // Fail CLOSED: this endpoint sends email, so never run without a configured secret.
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  initClosingTables();
  if (berlinHourNow() < SEND_HOUR_BERLIN) {
    return NextResponse.json({ ok: true, skipped: 'before send hour' });
  }

  // After 05:00 the current operational date is TODAY, so last night = yesterday.
  const lastNight = shiftDay(closingOperationalDate(), -1);
  const result = { companies: 0, emailed: 0, skipped: 0, errors: 0 };

  for (const companyId of companiesWithMissingEmail()) {
    result.companies += 1;
    try {
      const participating = departmentIdsWithQuestions(companyId);
      if (participating.length === 0) { result.skipped += 1; continue; }
      const submitted = new Set(listReportsForDate(companyId, lastNight).map((r) => r.department_id));
      const missingIds = participating.filter((id) => !submitted.has(id));
      if (missingIds.length === 0) { result.skipped += 1; continue; }

      const recipients = recipientsForCompany(companyId);
      if (recipients.length === 0) { result.skipped += 1; continue; }

      // Everything fallible that needs no claim happens FIRST, so a failure
      // here leaves the night unclaimed and the next hourly run retries.
      const depts = await fetchDepartments(companyId);
      const nameById = new Map(depts.map((d) => [d.id, d.name]));
      const missingNames = missingIds.map((id) => nameById.get(id) || `Department ${id}`);

      // Claim just before sending — a partial send must not repeat for those
      // who already got it, so the claim is company-wide and kept unless NO
      // email at all went out (then it's released for the next run).
      if (!claimMissingEmail(companyId, lastNight)) { result.skipped += 1; continue; }

      let sentAny = false;
      for (const r of recipients) {
        try {
          await sendClosingReportMissingEmail(r.email, r.name, lastNight, missingNames, companyId);
          result.emailed += 1;
          sentAny = true;
        } catch (err) {
          result.errors += 1;
          console.error(`[closing-report] cron: email to ${r.email} failed (company ${companyId}):`, err);
        }
      }
      if (!sentAny) {
        releaseMissingEmailClaim(companyId, lastNight);
      }
    } catch (err) {
      result.errors += 1;
      console.error(`[closing-report] cron: company ${companyId} failed:`, err);
    }
  }

  return NextResponse.json({ ok: true, night: lastNight, ...result });
}
