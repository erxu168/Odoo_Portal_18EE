import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

export async function GET(
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
  const seed = await odoo.read('mrp.bom', [bomId], ['version_root_id', 'product_tmpl_id']);
  if (!seed.length) {
    return NextResponse.json({ error: 'BOM not found' }, { status: 404 });
  }
  const rootId = seed[0].version_root_id?.[0];
  if (!rootId) {
    return NextResponse.json({ error: 'BOM has no version root (run module update).' }, { status: 500 });
  }

  const versions = await odoo.searchRead(
    'mrp.bom',
    [['version_root_id', '=', rootId]],
    [
      'id', 'version_label', 'version_notes', 'version_parent_id',
      'is_current_version', 'create_date', 'create_uid', 'bom_line_ids',
    ],
    { order: 'create_date desc', limit: 200 },
  );

  return NextResponse.json({
    product_tmpl_id: seed[0].product_tmpl_id,
    versions: versions.map((v: any) => ({
      id: v.id,
      version_label: v.version_label,
      version_notes: v.version_notes,
      parent_id: v.version_parent_id ? v.version_parent_id[0] : null,
      is_current_version: v.is_current_version,
      created_at: v.create_date,
      created_by: v.create_uid && v.create_uid[1] ? v.create_uid[1] : null,
      line_count: (v.bom_line_ids || []).length,
    })),
  });
}
