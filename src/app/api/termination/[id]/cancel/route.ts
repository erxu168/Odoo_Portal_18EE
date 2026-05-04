import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireRole, AuthError } from '@/lib/auth';
import { TERMINATION_DETAIL_FIELDS } from '@/types/termination';

const MODEL = 'kw.termination';

/**
 * POST /api/termination/:id/cancel
 * Cancel a termination. Resets the employee departure date.
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

    const records = await odoo.read(MODEL, [numId], ['state', 'employee_id']);
    if (!records || records.length === 0) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const rec = records[0];

    if (rec.state === 'archived' || rec.state === 'cancelled') {
      return NextResponse.json(
        { ok: false, error: 'Cannot cancel an archived or already cancelled record' },
        { status: 400 },
      );
    }

    // Reset employee departure date
    const empId = rec.employee_id[0];
    await odoo.write('hr.employee', [empId], {
      departure_date: false,
      departure_reason_id: false,
    });

    // Set state to cancelled
    await odoo.write(MODEL, [numId], { state: 'cancelled' });

    // Post to chatter
    await odoo.call(MODEL, 'message_post', [numId], {
      body: 'K\u00fcndigung storniert. Austrittsdatum zur\u00fcckgesetzt.',
      message_type: 'comment',
    });

    const updated = await odoo.read(MODEL, [numId], TERMINATION_DETAIL_FIELDS);
    return NextResponse.json({ ok: true, data: updated[0] });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
