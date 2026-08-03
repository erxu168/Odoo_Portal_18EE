/**
 * PUT /api/tasks/review/flag  { line_id, flagged, reason? }
 *
 * Manager flags/clears a proof photo. OVERSIGHT ONLY — the task stays done.
 * On flag, the staff member who did it gets a phone push telling them it looked
 * wrong (with the reason). Company-scoped via the Odoo method (fails closed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { setPhotoFlag } from '@/lib/task-review';
import { notifyEmployee } from '@/lib/shifts-notify';

export const dynamic = 'force-dynamic';

const MAX_REASON = 200;

export async function PUT(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const body = await req.json();
    const lineId = Number(body?.line_id);
    if (!Number.isInteger(lineId) || lineId <= 0) {
      return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });
    }
    const flagged = !!body?.flagged;
    let reason: string | null = null;
    if (flagged) {
      reason = String(body?.reason ?? '').trim().slice(0, MAX_REASON) || null;
    }
    const result = await setPhotoFlag(lineId, flagged, reason, user.employee_id ?? null, allowed);

    // Tell the staff member who did it — but never let a push failure fail the flag.
    if (result.flagged && result.completed_by_id) {
      try {
        await notifyEmployee(result.completed_by_id, result.company_id, 'task_photo_flagged', {
          title: 'A photo was flagged',
          body: `${result.name}: ${result.reason}`,
          url: '/tasks/staff',
          taskName: result.name,
          reason: result.reason,
        });
      } catch (e) {
        console.error('[tasks] flag notify failed (flag still saved):', e);
      }
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] PUT /api/tasks/review/flag error:', err);
    const message = err instanceof Error ? err.message : 'Could not update the flag.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
