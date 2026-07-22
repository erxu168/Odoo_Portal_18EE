export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/categories
 *
 * Returns all product categories from Odoo for use in the draft-product
 * review panel.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
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

/**
 * POST /api/inventory/categories  { name, parent_id? }
 *
 * Quick-create a product.category in Odoo so a manager can add a missing
 * category without leaving the product form (in-place create rule). Gated by
 * the same permission as editing product settings. Optionally nests under an
 * existing parent category. Returns the created record (id/name/complete_name).
 */
export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const parentId = Number.isInteger(body.parent_id) && body.parent_id > 0 ? body.parent_id : undefined;

  try {
    const odoo = getOdoo();
    const vals: Record<string, any> = { name };
    if (parentId) vals.parent_id = parentId;
    const id = await odoo.create('product.category', vals);
    const [created] = await odoo.searchRead(
      'product.category',
      [['id', '=', id]],
      ['id', 'name', 'complete_name'],
      { limit: 1 },
    );
    return NextResponse.json({ category: created || { id, name, complete_name: name } }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
