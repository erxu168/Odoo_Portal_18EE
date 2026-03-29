/**
 * POST /api/hr/termination/[id]/send-accountant
 *
 * Triggers the action_send_to_accountant button on the Odoo model.
 */
import { NextRequest, NextResponse } from 'next/server';
import { odooRpc } from '@/lib/odoo';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

    // Check if already sent
    const records = await odooRpc('kw.termination', 'read', [[recordId]], {
      fields: ['sent_to_accountant'],
    });

    if (!records || records.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (records[0].sent_to_accountant) {
      return NextResponse.json({ error: 'Already sent to accountant' }, { status: 400 });
    }

    // Call the Odoo button action
    await odooRpc('kw.termination', 'action_send_to_accountant', [[recordId]]);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
