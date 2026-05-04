import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { TERMINATION_DETAIL_FIELDS } from '@/types/termination';

const MODEL = 'kw.termination';

/**
 * POST /api/termination/:id/archive
 * Archive the employee and move termination to 'archived' state.
 * Calls action_archive_employee() on the Odoo model which:
 *   1. Sets employee active = False
 *   2. Sets termination state = 'archived'
 *   3. Posts to chatter
 *
 * Only allowed when state = 'delivered'.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const odoo = getOdoo();
    const numId = Number(id);

    const records = await odoo.read(MODEL, [numId], ['state', 'last_working_day', 'employee_id']);
    if (!records || records.length === 0) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    const rec = records[0];

    if (rec.state !== 'delivered') {
      return NextResponse.json(
        { ok: false, error: 'Can only archive from delivered state' },
        { status: 400 },
      );
    }

    // Server-side date guard: last_working_day must be in the past or today
    if (rec.last_working_day) {
      const today = new Date().toISOString().slice(0, 10);
      if (rec.last_working_day > today) {
        return NextResponse.json(
          { ok: false, error: 'Cannot archive before the last working day has passed' },
          { status: 400 },
        );
      }
    }

    // Call the Odoo method that archives the employee
    await odoo.call(MODEL, 'action_archive_employee', [[numId]]);

    const updated = await odoo.read(MODEL, [numId], TERMINATION_DETAIL_FIELDS);
    return NextResponse.json({ ok: true, data: updated[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[termination/archive]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
