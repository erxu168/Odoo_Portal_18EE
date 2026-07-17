/**
 * POST /api/shifts/unpublish-week {company_id, week, notify?}
 *
 * The mirror of publish-week: every PUBLISHED slot of the company-week goes back
 * to draft in one batched Odoo write, so staff stop seeing them (the shifts are
 * NOT deleted — Delete is the separate "gone for good" path). Live cover requests
 * are invalidated and staff confirmations cleared; each distinct assigned
 * employee is notified once (shift_unpublished) unless notify:false. Idempotent —
 * a week with no published shifts returns { unpublished: 0 }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchWeekSlots } from '@/lib/shifts-odoo';
import { requireManagerCompany, resolveWeekKey, serverError } from '../_manager';
import { unpublishSlots } from '../_unpublish';

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
    const notify = body.notify !== false; // default: notify affected staff

    const slots = await fetchWeekSlots(companyId, weekKey);
    const unpublished = await unpublishSlots(companyId, slots, notify);
    return NextResponse.json({ ok: true, unpublished });
  } catch (err: unknown) {
    return serverError('POST unpublish-week', err);
  }
}
