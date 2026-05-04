import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { TERMINATION_DETAIL_FIELDS } from '@/types/termination';

const MODEL = 'kw.termination';

/**
 * POST /api/termination/:id/confirm
 * Confirm a draft termination.
 * Sets state to 'confirmed', sets employee departure date.
 * PDF generation is handled separately via /api/termination/:id/pdf
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireRole('manager');
    const { id } = await params;
    const odoo = getOdoo();
    const numId = Number(id);

    // Read current state
    const records = await odoo.read(MODEL, [numId], ['state', 'last_working_day', 'employee_id']);
    if (!records || records.length === 0) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const rec = records[0];

    if (rec.state !== 'draft') {
      return NextResponse.json(
        { ok: false, error: 'Can only confirm draft records' },
        { status: 400 },
      );
    }

    if (!rec.last_working_day) {
      return NextResponse.json(
        { ok: false, error: 'Letzter Arbeitstag muss gesetzt sein' },
        { status: 400 },
      );
    }

    // Set employee departure date
    const empId = rec.employee_id[0];
    await odoo.write('hr.employee', [empId], {
      departure_date: rec.last_working_day,
    });

    // Update state
    await odoo.write(MODEL, [numId], { state: 'confirmed' });

    // Post to chatter
    await odoo.call(MODEL, 'message_post', [numId], {
      body: `K\u00fcndigung best\u00e4tigt. Austrittsdatum: ${rec.last_working_day}`,
      message_type: 'comment',
    });

    const updated = await odoo.read(MODEL, [numId], TERMINATION_DETAIL_FIELDS);
    return NextResponse.json({ ok: true, data: updated[0] });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
