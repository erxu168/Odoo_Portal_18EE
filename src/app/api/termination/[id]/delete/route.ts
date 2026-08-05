import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { AuthError } from '@/lib/auth';
import { requireTerminationAccess } from '@/lib/termination-access';
import { moduleForbidden } from '@/lib/module-access';

/**
 * POST /api/termination/:id/delete
 * Permanently delete a DRAFT termination record.
 * Only drafts can be deleted — other states are rejected.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = moduleForbidden('termination');
  if (denied) return denied;

  try {
    const { id } = await params;
    await requireTerminationAccess(Number(id));
    const termId = Number(id);
    const odoo = getOdoo();

    // Verify it's a draft
    const records = await odoo.read('kw.termination', [termId], ['state', 'employee_name']);
    if (!records || records.length === 0) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    if (records[0].state !== 'draft') {
      return NextResponse.json({ ok: false, error: 'Only draft terminations can be deleted' }, { status: 400 });
    }

    await odoo.unlink('kw.termination', [termId]);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/termination/[id]/delete error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
