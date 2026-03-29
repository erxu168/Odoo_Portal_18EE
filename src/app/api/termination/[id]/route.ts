import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { TERMINATION_DETAIL_FIELDS } from '@/types/termination';

const MODEL = 'kw.termination';

/**
 * GET /api/termination/:id
 * Get a single termination record with all fields.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const odoo = getOdoo();
    const records = await odoo.read(MODEL, [Number(id)], TERMINATION_DETAIL_FIELDS);
    if (!records || records.length === 0) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: records[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
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
    const { id } = await params;
    const odoo = getOdoo();
    const body = await req.json();

    await odoo.write(MODEL, [Number(id)], body);

    // Read back updated record
    const records = await odoo.read(MODEL, [Number(id)], TERMINATION_DETAIL_FIELDS);
    return NextResponse.json({ ok: true, data: records[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
