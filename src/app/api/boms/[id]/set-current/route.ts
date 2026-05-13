import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    requireAuth();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const bomId = Number(params.id);
  if (!Number.isInteger(bomId)) {
    return NextResponse.json({ error: 'Invalid BOM id' }, { status: 400 });
  }

  const odoo = getOdoo();
  const target = await odoo.read('mrp.bom', [bomId], ['version_root_id', 'is_current_version']);
  if (!target.length) {
    return NextResponse.json({ error: 'BOM not found' }, { status: 404 });
  }
  if (target[0].is_current_version) {
    return NextResponse.json({ bom_id: bomId, already_current: true });
  }
  const rootId = target[0].version_root_id?.[0];

  // Flip the previously-current one off FIRST to satisfy the at-most-one
  // constraint on mrp.bom (_check_single_current_version).
  const priors = await odoo.searchRead(
    'mrp.bom',
    [
      ['version_root_id', '=', rootId],
      ['is_current_version', '=', true],
      ['id', '!=', bomId],
    ],
    ['id'],
  );
  if (priors.length) {
    await odoo.write('mrp.bom', priors.map((p: any) => p.id), { is_current_version: false });
  }
  await odoo.write('mrp.bom', [bomId], { is_current_version: true });
  return NextResponse.json({ bom_id: bomId, current: true });
}
