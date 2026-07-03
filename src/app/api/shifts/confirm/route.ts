/**
 * POST /api/shifts/confirm — staff confirms they'll work a shift ("I'll be there").
 * Body: { company_id, slot_id }. The slot must be the caller's own published shift.
 */
import { NextResponse } from 'next/server';
import { AuthError, requireAuth } from '@/lib/auth';
import { fetchSlot } from '@/lib/shifts-odoo';
import { confirmSlot } from '@/lib/shifts-db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = requireAuth();
    if (!user.employee_id) {
      return NextResponse.json({ error: 'No employee is linked to your account.' }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = parseInt(String(body.company_id ?? ''), 10);
    const slotId = parseInt(String(body.slot_id ?? ''), 10);
    if (!Number.isInteger(companyId) || companyId <= 0 || !Number.isInteger(slotId) || slotId <= 0) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const slot = await fetchSlot(slotId);
    if (!slot || slot.companyId !== companyId) {
      return NextResponse.json({ error: 'Shift not found.' }, { status: 404 });
    }
    if (slot.employeeId !== user.employee_id) {
      return NextResponse.json({ error: 'That is not your shift.' }, { status: 403 });
    }
    if (slot.state !== 'published') {
      return NextResponse.json({ error: 'This shift is not published yet.' }, { status: 400 });
    }

    confirmSlot(slotId, companyId, user.employee_id);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[shifts] confirm error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not confirm the shift.' }, { status: 500 });
  }
}
