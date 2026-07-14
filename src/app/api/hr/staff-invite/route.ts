/**
 * POST /api/hr/staff-invite  { employee_id }
 *
 * Manager-accessible: generate (and email, if an address is on file) a
 * self-onboarding invite link for one of the manager's own staff. The employee
 * opens the link, sets a password, and their portal account is created linked
 * to them — then they fill in their own details and documents.
 *
 * Admins use the fuller Staff Access screen; this is the in-flow version for the
 * Add-staff form. Scoped to the manager's own company.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { createStaffInvite, inviteEmailNotice } from '@/lib/hr/invites';

export async function POST(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const body = await req.json().catch(() => ({}));
    const employeeId = Number(body.employee_id);
    if (!employeeId) {
      return NextResponse.json({ error: 'employee_id is required' }, { status: 400 });
    }

    // Scope check: managers may only invite staff in their own restaurant(s).
    if (user.role !== 'admin') {
      const rows = await getOdoo().read('hr.employee', [employeeId], ['company_id']);
      const compRaw = rows?.[0]?.company_id;
      const companyId = Array.isArray(compRaw) ? (compRaw[0] as number) : null;
      const allowed = parseCompanyIds(user.allowed_company_ids);
      if (!companyId || !allowed.includes(companyId)) {
        return NextResponse.json({ error: 'You can only invite staff in your own restaurant.' }, { status: 403 });
      }
    }

    const result = await createStaffInvite(employeeId, { id: user.id, name: user.name || user.email }, { sendEmail: true });
    // Tell the manager plainly whether the email went out, so they know when
    // they still have to hand the link over themselves.
    const status = result.body.email_status;
    const message =
      result.ok && status
        ? inviteEmailNotice(status, result.body.name || 'This staff member', result.body.email ?? null)
        : undefined;
    return NextResponse.json(message ? { ...result.body, message } : result.body, { status: result.status });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/hr/staff-invite error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create invite' }, { status: 500 });
  }
}
