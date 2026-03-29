import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { TERMINATION_DETAIL_FIELDS, DELIVERY_METHOD_LABELS } from '@/types/termination';
import type { DeliveryMethod } from '@/types/termination';

const MODEL = 'kw.termination';

/**
 * POST /api/termination/:id/deliver
 * Mark a signed termination as delivered.
 * Body: { delivery_method, delivery_date, delivery_tracking_number?, delivery_witness? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const odoo = getOdoo();
    const numId = Number(id);
    const body = await req.json();

    if (!body.delivery_method || !body.delivery_date) {
      return NextResponse.json(
        { ok: false, error: 'delivery_method and delivery_date are required' },
        { status: 400 },
      );
    }

    const method = body.delivery_method as DeliveryMethod;
    if ((method === 'personal' || method === 'bote') && !body.delivery_witness) {
      return NextResponse.json(
        { ok: false, error: 'Zeuge ist bei pers\u00f6nlicher \u00dcbergabe / Bote erforderlich' },
        { status: 400 },
      );
    }

    const vals: Record<string, unknown> = {
      state: 'delivered',
      delivery_method: body.delivery_method,
      delivery_date: body.delivery_date,
    };
    if (body.delivery_tracking_number) vals.delivery_tracking_number = body.delivery_tracking_number;
    if (body.delivery_witness) vals.delivery_witness = body.delivery_witness;
    if (body.delivery_notes) vals.delivery_notes = body.delivery_notes;

    await odoo.write(MODEL, [numId], vals);

    // Chatter message
    const label = DELIVERY_METHOD_LABELS[method] || method;
    let msg = `K\u00fcndigung zugestellt am ${body.delivery_date} per ${label}.`;
    if (body.delivery_tracking_number) msg += ` Sendungsnr.: ${body.delivery_tracking_number}`;
    if (body.delivery_witness) msg += ` Zeuge: ${body.delivery_witness}`;
    await odoo.call(MODEL, 'message_post', [numId], {
      body: msg,
      message_type: 'comment',
    });

    const updated = await odoo.read(MODEL, [numId], TERMINATION_DETAIL_FIELDS);
    return NextResponse.json({ ok: true, data: updated[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
