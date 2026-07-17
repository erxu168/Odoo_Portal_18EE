/**
 * POST /api/shifts/unpublish-slot {company_id, slot_id, notify?}
 *
 * Single-shift unpublish (the manager quick-menu action): one published slot
 * goes back to draft. Idempotent — an already-draft slot returns
 * { unpublished: 0 }. Shared side-effects (cover-request invalidation,
 * confirmation cleanup, staff notification) live in _unpublish.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchSlot } from '@/lib/shifts-odoo';
import { requireManagerCompany, serverError } from '../_manager';
import { unpublishSlots } from '../_unpublish';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const slotId =
      typeof body.slot_id === 'number' ? body.slot_id : parseInt(String(body.slot_id ?? ''), 10);
    if (!Number.isInteger(slotId) || slotId <= 0) {
      return NextResponse.json({ error: 'slot_id is required' }, { status: 400 });
    }
    const notify = body.notify !== false; // default: notify the assignee

    const slot = await fetchSlot(slotId);
    if (!slot || slot.companyId !== companyId) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }

    const unpublished = await unpublishSlots(companyId, [slot], notify);
    return NextResponse.json({ ok: true, unpublished });
  } catch (err: unknown) {
    return serverError('POST unpublish-slot', err);
  }
}
