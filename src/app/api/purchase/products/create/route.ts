/**
 * POST /api/purchase/products/create
 * Create a NEW orderable product in Odoo (manager+), then return it in the same
 * shape as GET /api/purchase/products so the caller can drop it straight into an
 * order guide. Mirrors the inventory scan-to-create flow, but marks the product
 * active + purchase_ok and sets the chosen unit / price / category.
 *
 * Body: { name, uom_id, price?, categ_id? }
 * Products are company-agnostic (no company_id), like the inventory create flow.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'purchase.product.manage', getPermissionOverrides())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const uomId = Number(body.uom_id);
  const categId = Number(body.categ_id);
  const price = typeof body.price === 'number' && isFinite(body.price) && body.price >= 0 ? body.price : 0;
  const defaultCode = typeof body.default_code === 'string' ? body.default_code.trim() : '';

  if (!name) return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
  if (!Number.isInteger(uomId) || uomId <= 0) return NextResponse.json({ error: 'A unit is required' }, { status: 400 });

  try {
    const odoo = getOdoo();
    const vals: Record<string, any> = {
      name,
      type: 'consu',
      uom_id: uomId,
      uom_po_id: uomId,
      purchase_ok: true,
      sale_ok: false,
      list_price: price,
      standard_price: price,
      active: true,
    };
    if (Number.isInteger(categId) && categId > 0) vals.categ_id = categId;
    if (defaultCode) vals.default_code = defaultCode;

    const newId = await odoo.create('product.product', vals);
    const rows = await odoo.read('product.product', [newId], ['id', 'name', 'uom_id', 'categ_id', 'list_price', 'default_code']);
    const p: any = rows[0] || {};
    return NextResponse.json(
      {
        product: {
          id: newId,
          name: p.name || name,
          uom: p.uom_id?.[1] || 'Units',
          price: typeof p.list_price === 'number' ? p.list_price : price,
          category_name: p.categ_id?.[1]?.split(' / ').pop() || 'Other',
          product_code: (typeof p.default_code === 'string' ? p.default_code : '') || defaultCode || '',
        },
      },
      { status: 201 },
    );
  } catch (e: unknown) {
    console.error('[purchase/products/create] Odoo create failed', e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Failed to create product in Odoo', detail }, { status: 502 });
  }
}
