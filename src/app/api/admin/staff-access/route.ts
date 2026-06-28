import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { listEmployeeIdsWithAccounts, listPendingInvites, logAudit } from '@/lib/db';
import { createStaffInvite, storeInviteForEmployee, sendInviteEmailsInBackground } from '@/lib/hr/invites';

/**
 * GET  /api/admin/staff-access  — list Odoo employees with portal account status.
 * POST /api/admin/staff-access  — { action: 'invite'|'resend'|'invite_all', employee_id? }
 * Admin only.
 */

interface OdooEmployee {
  id: number;
  name?: string;
  work_email?: string | false;
  private_email?: string | false;
  mobile_phone?: string | false;
  department_id?: [number, string] | false;
}

async function fetchEmployees(): Promise<OdooEmployee[]> {
  const odoo = getOdoo();
  return (await odoo.searchRead(
    'hr.employee',
    [['active', '=', true]],
    ['name', 'work_email', 'private_email', 'mobile_phone', 'department_id'],
    { limit: 1000, order: 'name asc' },
  )) as OdooEmployee[];
}

function emailOf(e: OdooEmployee): string {
  return (e.work_email || e.private_email || '') as string;
}

export async function GET() {
  const me = getCurrentUser();
  if (!me || !hasRole(me, 'admin')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  try {
    const employees = await fetchEmployees();
    const accountIds = new Set(listEmployeeIdsWithAccounts());
    const pendingByEmp = new Map<number, string>();
    for (const inv of listPendingInvites()) {
      if (!pendingByEmp.has(inv.employee_id)) pendingByEmp.set(inv.employee_id, inv.created_at);
    }

    const rows = employees.map((e) => {
      const status = accountIds.has(e.id) ? 'active' : pendingByEmp.has(e.id) ? 'invited' : 'none';
      return {
        employee_id: e.id,
        name: e.name || 'Unnamed',
        email: emailOf(e),
        phone: (e.mobile_phone || '') as string,
        department: Array.isArray(e.department_id) ? e.department_id[1] : '',
        status,
        invited_at: pendingByEmp.get(e.id) || null,
      };
    });

    const counts = {
      total: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      invited: rows.filter((r) => r.status === 'invited').length,
      none: rows.filter((r) => r.status === 'none').length,
    };

    return NextResponse.json({ employees: rows, counts });
  } catch (err: unknown) {
    console.error('GET /api/admin/staff-access error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load staff' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const me = getCurrentUser();
  if (!me || !hasRole(me, 'admin')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const actor = { id: me.id, name: me.name };

  try {
    const body = await request.json();
    const action = body.action as string;

    if (action === 'invite' || action === 'resend') {
      const employeeId = Number(body.employee_id);
      const result = await createStaffInvite(employeeId, actor, { sendEmail: true });
      if (!result.ok) {
        return NextResponse.json({ error: result.body.error }, { status: result.status });
      }
      const verb = action === 'resend' ? 'Invite re-sent' : 'Invite sent';
      return NextResponse.json({
        message: result.body.email_sent
          ? `${verb} to ${result.body.name}.`
          : `${verb} for ${result.body.name}. No email on file — use the copy link to share it.`,
        link: result.body.link,
        share_text: result.body.share_text,
        email_sent: result.body.email_sent,
      });
    }

    if (action === 'invite_all') {
      const employees = await fetchEmployees();
      const accountIds = new Set(listEmployeeIdsWithAccounts());
      const pendingIds = new Set(listPendingInvites().map((i) => i.employee_id));

      const targets = employees.filter((e) => !accountIds.has(e.id) && !pendingIds.has(e.id));
      const toEmail: { email: string; name: string; link: string }[] = [];
      let created = 0;
      let failed = 0;

      for (const e of targets) {
        try {
          const email = emailOf(e) || null;
          const { link } = await storeInviteForEmployee(
            { id: e.id, name: e.name || 'Team member', email },
            actor,
            false,
          );
          created += 1;
          if (email) toEmail.push({ email, name: e.name || 'Team member', link });
        } catch (err: unknown) {
          failed += 1;
          console.error(`[staff-access] invite_all failed for employee ${e.id}:`, err);
        }
      }

      // Send the emails in the background so the request returns promptly.
      void sendInviteEmailsInBackground(toEmail);

      logAudit({
        user_id: me.id,
        user_name: me.name,
        action: 'invite_all_staff',
        module: 'staff_access',
        detail: `Invited ${created} staff (${toEmail.length} emailed), ${employees.length - targets.length} skipped, ${failed} failed`,
      });

      const skipped = employees.length - targets.length;
      return NextResponse.json({
        message: `Invited ${created} staff${toEmail.length ? ` (emailing ${toEmail.length})` : ''}. ${skipped} already set up or invited.`,
        created,
        skipped,
        failed,
        emailing: toEmail.length,
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use invite, resend, or invite_all.' }, { status: 400 });
  } catch (err: unknown) {
    console.error('POST /api/admin/staff-access error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process request' },
      { status: 500 },
    );
  }
}
