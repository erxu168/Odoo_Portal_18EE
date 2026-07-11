/**
 * POST /api/shifts/confirm/nudge — a manager re-sends a "please confirm" push
 * for one assigned, published shift. Body: { company_id, slot_id }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchSlot } from '@/lib/shifts-odoo';
import { notifyEmployee } from '@/lib/shifts-notify';
import { fmtDay, fmtTimeRange } from '@/lib/shifts-time';
import { requireManagerCompany, serverError } from '../../_manager';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;

    const slotId = parseInt(String(body.slot_id ?? ''), 10);
    if (!Number.isInteger(slotId) || slotId <= 0) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const slot = await fetchSlot(slotId);
    if (!slot || slot.companyId !== auth.companyId || slot.employeeId === null) {
      return NextResponse.json({ error: 'Assigned shift not found.' }, { status: 404 });
    }

    await notifyEmployee(slot.employeeId, auth.companyId, 'confirm_reminder', {
      day: fmtDay(slot.start),
      time: fmtTimeRange(slot.start, slot.end),
      roleName: slot.roleName,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('confirm nudge', err);
  }
}
