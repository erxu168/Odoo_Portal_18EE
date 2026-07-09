import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireCapability, AuthError } from '@/lib/auth';

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireCapability('manufacturing.mo.saveversion');
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const moId = Number(params.id);
  if (!Number.isInteger(moId)) {
    return NextResponse.json({ error: 'Invalid MO id' }, { status: 400 });
  }

  let body: { version_label?: string; version_notes?: string; make_current?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const label = (body.version_label || '').trim();
  if (!label) {
    return NextResponse.json({ error: 'Version label is required.' }, { status: 400 });
  }
  if (label.length > 64) {
    return NextResponse.json({ error: 'Version label must be 64 characters or fewer.' }, { status: 400 });
  }
  const notes = (body.version_notes || '').trim();
  if (notes.length > 1000) {
    return NextResponse.json({ error: 'Notes must be 1000 characters or fewer.' }, { status: 400 });
  }
  const makeCurrent = body.make_current !== false;

  const odoo = getOdoo();
  try {
    const result = await odoo.call(
      'mrp.production',
      'action_save_as_new_bom_version',
      [[moId], label, notes, makeCurrent],
    );
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to save version.';
    // Odoo UserError surfaces as a JSON-RPC error with a debug stack;
    // strip the "odoo.exceptions.UserError: " prefix when present.
    const clean = message.replace(/.*UserError:\s*/, '').split('\n')[0];
    return NextResponse.json({ error: clean }, { status: 422 });
  }
}
