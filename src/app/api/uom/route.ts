/**
 * GET /api/uom — list available Units of Measure from Odoo.
 * Cached client-side since UoM rarely changes.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const odoo = getOdoo();
    const uoms = await odoo.searchRead(
      'uom.uom', [],
      ['id', 'name', 'category_id', 'factor', 'uom_type'],
      { order: 'category_id, factor', limit: 200 },
    );

    return NextResponse.json({
      uoms: uoms.map((u: Record<string, unknown>) => ({
        id: u.id,
        name: u.name,
        category: Array.isArray(u.category_id) ? u.category_id[1] : '',
        category_id: Array.isArray(u.category_id) ? u.category_id[0] : null,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('UoM list error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
