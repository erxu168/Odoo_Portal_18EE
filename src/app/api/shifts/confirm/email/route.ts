/**
 * POST /api/shifts/confirm/email  { token }
 *
 * Confirm a shift from the one-tap link in a reminder email — NO login required.
 * The token (shift_confirm_tokens) identifies the (slot, employee). Idempotent: a
 * re-click still returns ok with the shift summary. Returns 200 with ok:false for
 * invalid / expired / reassigned so the public /confirm-shift page can render a
 * friendly state instead of an error.
 */
import { NextResponse } from 'next/server';
import { resolveShiftConfirmToken, confirmSlot } from '@/lib/shifts-db';
import { fetchSlot } from '@/lib/shifts-odoo';
import { fmtDay, fmtTimeRange } from '@/lib/shifts-time';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) return NextResponse.json({ ok: false, error: 'missing_token' });

    const t = resolveShiftConfirmToken(token);
    if (!t) return NextResponse.json({ ok: false, error: 'invalid_or_expired' });

    const slot = await fetchSlot(t.slotId);
    if (!slot || slot.companyId !== t.companyId) {
      return NextResponse.json({ ok: false, error: 'not_found' });
    }
    if (slot.state !== 'published') {
      // Pulled back to draft since the email went out — don't record a confirmation
      // on an unpublished slot (mirrors the authenticated confirm route).
      return NextResponse.json({ ok: false, error: 'not_published' });
    }
    if (slot.employeeId !== t.employeeId) {
      // Shift was reassigned since the email went out — nothing for this person to confirm.
      return NextResponse.json({ ok: false, error: 'reassigned' });
    }

    confirmSlot(t.slotId, t.companyId, t.employeeId);
    return NextResponse.json({
      ok: true,
      day: fmtDay(slot.start),
      time: fmtTimeRange(slot.start, slot.end),
      roleName: slot.roleName,
      employeeName: slot.employeeName,
    });
  } catch (err: unknown) {
    console.error('[shifts] email-confirm error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
