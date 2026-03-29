/**
 * GET   /api/hr/termination/[id]  — detail
 * PATCH /api/hr/termination/[id]  — update
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { TERMINATION_DETAIL_FIELDS } from '@/types/termination';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

    const odoo = getOdoo();
    const records = await odoo.read('kw.termination', [recordId], [...TERMINATION_DETAIL_FIELDS]);

    if (!records || records.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ record: records[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

    const body = await req.json();
    const vals: Record<string, unknown> = {};

    const allowedFields = [
      'termination_type', 'letter_date', 'calc_method', 'receipt_date',
      'resignation_method', 'resignation_received_date',
      'garden_leave', 'include_severance', 'severance_amount',
      'incident_date', 'incident_description', 'state',
      'zeugnis_grade', 'written_resignation_received',
    ];

    for (const f of allowedFields) {
      if (body[f] !== undefined) vals[f] = body[f];
    }

    if (Object.keys(vals).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const odoo = getOdoo();
    await odoo.call('kw.termination', 'write', [[recordId], vals]);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
