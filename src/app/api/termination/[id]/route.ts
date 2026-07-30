import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { TERMINATION_DETAIL_FIELDS } from '@/types/termination';

const MODEL = 'kw.termination';

// "Reality facts" — operational details a manager may correct at any active
// state (the Odoo model guards transitions, terminal states and flags the
// stored letter when a letter-relevant field like last_working_day changes).
const ALLOWED_FIELDS = [
  'delivery_method', 'delivery_date', 'delivery_tracking_number',
  'delivery_witness', 'receipt_date', 'delivery_confirmed_date',
  'delivery_notes', 'last_working_day',
];
// The one direct state write left: the manual bookkeeping step confirmed ->
// signed. Every other transition goes through a validated model action.
const ALLOWED_STATES = ['signed'];

/**
 * GET /api/termination/:id
 * Get a single termination record with all fields.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireRole('manager');
    const { id } = await params;
    const odoo = getOdoo();
    const records = await odoo.read(MODEL, [Number(id)], TERMINATION_DETAIL_FIELDS);
    if (!records || records.length === 0) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: records[0] });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/termination/:id
 * Update termination fields. Body: partial field values.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireRole('manager');
    const { id } = await params;
    const odoo = getOdoo();
    const body = await req.json();

    // Field allowlist — only pass safe fields to Odoo
    const safeBody: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (ALLOWED_FIELDS.includes(key)) safeBody[key] = body[key];
    }
    if (typeof body.state === 'string' && ALLOWED_STATES.includes(body.state)) {
      safeBody.state = body.state;
    }
    if (Object.keys(safeBody).length === 0) {
      return NextResponse.json({ ok: false, error: 'No editable fields in request' }, { status: 400 });
    }

    await odoo.write(MODEL, [Number(id)], safeBody);

    // Read back updated record
    const records = await odoo.read(MODEL, [Number(id)], TERMINATION_DETAIL_FIELDS);
    return NextResponse.json({ ok: true, data: records[0] });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
