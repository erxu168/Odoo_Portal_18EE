/**
 * POST /api/shifts/unassign-slots {company_id, slot_ids, notify?}
 *
 * Multi-select unassign: clear the assignee from each of the given shifts (they
 * become OPEN, not deleted). Slots not in the company, missing, or already open
 * are ignored, so the call is idempotent. See _unassign.ts for the shared
 * side-effects (cover-request invalidation, confirmation cleanup, over-cap
 * recompute, one shift_changed notice per removed employee).
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchSlot } from '@/lib/shifts-odoo';
import type { ShiftSlot } from '@/types/shifts';
import { requireManagerCompany, serverError } from '../_manager';
import { unassignSlots } from '../_unassign';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const rawIds = Array.isArray(body.slot_ids) ? body.slot_ids : [];
    const ids = Array.from(
      new Set(
        rawIds
          .map(v => (typeof v === 'number' ? v : parseInt(String(v), 10)))
          .filter(n => Number.isInteger(n) && n > 0),
      ),
    );
    if (ids.length === 0) {
      return NextResponse.json({ error: 'slot_ids is required' }, { status: 400 });
    }
    const notify = body.notify !== false; // default: notify removed staff

    const fetched = await Promise.all(ids.map(id => fetchSlot(id)));
    const slots = fetched.filter((s): s is ShiftSlot => s !== null && s.companyId === companyId);

    const result = await unassignSlots(companyId, slots, notify);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    return serverError('POST unassign-slots', err);
  }
}
