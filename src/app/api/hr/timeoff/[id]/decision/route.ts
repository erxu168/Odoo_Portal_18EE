/**
 * POST /api/hr/timeoff/[id]/decision  { decision: 'approve' | 'refuse' }
 * Approve or refuse a time-off request. Permission: admins any restaurant,
 * managers only their own restaurant(s) — enforced here (Odoo uid 2 can act on
 * anything). Approve handles double-validation types by validating the second step.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireRole('manager');
    const leaveId = parseInt(params.id, 10);
    if (!leaveId) return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });

    const body = await req.json();
    const decision = body.decision;
    if (decision !== 'approve' && decision !== 'refuse') {
      return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
    }

    const odoo = getOdoo();
    const rows = await odoo.searchRead('hr.leave', [['id', '=', leaveId]], ['state', 'company_id'], { limit: 1 });
    if (!rows.length) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    const state = rows[0].state;
    const cId = Array.isArray(rows[0].company_id) ? rows[0].company_id[0] : null;

    // Permission: managers only their own restaurant(s).
    if (user.role !== 'admin') {
      const allowed = parseCompanyIds(user.allowed_company_ids);
      if (cId === null || !allowed.includes(cId)) {
        return NextResponse.json({ error: 'You can only decide requests for your own restaurant.' }, { status: 403 });
      }
    }

    if (!['confirm', 'validate1'].includes(state)) {
      return NextResponse.json({ error: 'This request has already been decided.' }, { status: 400 });
    }

    if (decision === 'approve') {
      // NOTE: core hr.leave.action_approve() is broken in this DB — the custom
      // krawings_vacation override of action_validate(self) dropped the argument
      // that hr_holidays_attendance.action_approve() passes it, so action_approve
      // raises a TypeError. Calling action_validate() directly moves the request
      // straight to 'validate' (approved), which is the state a portal approval wants.
      await odoo.buttonCall('hr.leave', 'action_validate', [leaveId]);
    } else {
      await odoo.buttonCall('hr.leave', 'action_refuse', [leaveId]);
    }

    const final = await odoo.searchRead('hr.leave', [['id', '=', leaveId]], ['state'], { limit: 1 });
    return NextResponse.json({ success: true, state: final.length ? final[0].state : null });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/hr/timeoff/[id]/decision error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update request' }, { status: 500 });
  }
}
