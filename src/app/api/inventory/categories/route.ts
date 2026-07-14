export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/categories
 *
 * Returns all product categories from Odoo for use in the draft-product
 * review panel.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const odoo = getOdoo();
    const categories = await odoo.searchRead(
      'product.category',
      [],
      ['id', 'name', 'complete_name'],
      { limit: 500, order: 'complete_name' },
    );
    return NextResponse.json({ categories });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
