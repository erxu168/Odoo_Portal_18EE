import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { AuthError } from '@/lib/auth';
import { requireTerminationAccess } from '@/lib/termination-access';
import { TERMINATION_DETAIL_FIELDS } from '@/types/termination';

const MODEL = 'kw.termination';

/**
 * POST /api/termination/:id/confirm-delivery
 * The courier/receipt confirmation: in_transit (or signed, for personal
 * handover) -> delivered, via the validated model action.
 * Body: { delivery_confirmed_date?, receipt_date?, delivery_notes? } — all optional;
 * the confirmation date defaults to today on the model.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireTerminationAccess(Number(id));
    const numId = Number(id);
    const odoo = getOdoo();
    const body = await req.json().catch(() => ({}));

    const vals: Record<string, unknown> = {};
    if (body.delivery_confirmed_date) vals.delivery_confirmed_date = body.delivery_confirmed_date;
    if (body.receipt_date) vals.receipt_date = body.receipt_date;
    if (body.delivery_notes) vals.delivery_notes = body.delivery_notes;
    if (Object.keys(vals).length) await odoo.write(MODEL, [numId], vals);

    await odoo.call(MODEL, 'action_confirm_delivery', [[numId]]);

    const records = await odoo.read(MODEL, [numId], TERMINATION_DETAIL_FIELDS);
    return NextResponse.json({ ok: true, data: records[0] });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/termination/[id]/confirm-delivery error:', err);
    const msg = err instanceof Error && /UserError|ValidationError/.test(String(err))
      ? String(err).split('\n').pop() : 'Internal server error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
