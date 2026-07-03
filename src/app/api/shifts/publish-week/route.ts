/**
 * POST /api/shifts/publish-week {company_id, week} — manager publishes drafts.
 *
 * All draft slots of the company-week become published in one batched Odoo
 * write. Each distinct ASSIGNED employee is notified exactly once
 * (shift_published, one notification per employee — not per slot).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { notifyEmployee } from '@/lib/shifts-notify';
import { fetchWeekSlots } from '@/lib/shifts-odoo';
import { fmtDay, fmtTimeRange } from '@/lib/shifts-time';
import type { ShiftSlot } from '@/types/shifts';
import { requireManagerCompany, resolveWeekKey, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const weekKey = resolveWeekKey(body.week);
    if (!weekKey) {
      return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
    }

    const slots = await fetchWeekSlots(companyId, weekKey);
    const drafts = slots.filter(s => s.state === 'draft');
    if (drafts.length === 0) {
      return NextResponse.json({ ok: true, published: 0 });
    }

    await getOdoo().write(
      'planning.slot',
      drafts.map(s => s.id),
      { state: 'published' },
    );

    // One shift_published notification per distinct assigned employee.
    const byEmployee = new Map<number, ShiftSlot[]>();
    for (const slot of drafts) {
      if (slot.employeeId === null) continue;
      const list = byEmployee.get(slot.employeeId) ?? [];
      list.push(slot);
      byEmployee.set(slot.employeeId, list);
    }
    const entries = Array.from(byEmployee.entries());
    for (const [employeeId, employeeSlots] of entries) {
      const first = employeeSlots[0];
      await notifyEmployee(employeeId, companyId, 'shift_published', {
        day: fmtDay(first.start),
        time: fmtTimeRange(first.start, first.end),
        roleName: first.roleName,
        weekKey,
        count: employeeSlots.length,
        message:
          employeeSlots.length === 1
            ? 'A new shift was published for you.'
            : `${employeeSlots.length} new shifts were published for you.`,
      });
    }

    return NextResponse.json({ ok: true, published: drafts.length });
  } catch (err: unknown) {
    return serverError('POST publish-week', err);
  }
}
