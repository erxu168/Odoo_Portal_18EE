/**
 * GET /api/inventory/products
 *
 * Proxies product.product from Odoo 18 EE.
 * Query params: ?category_id=32&search=soju&limit=100&ids=891,950,938
 *
 * Scope: only raw stock, not POS-sellable items. Includes archived
 * (active=False) products so draft products created via the scan-to-count
 * flow show up during review.
 *
 * POST /api/inventory/products
 *
 * Creates a draft product in Odoo (active=False) with a barcode attached.
 * Used by the "scan unknown barcode" flow. Manager later approves,
 * links to existing, or rejects via the other product endpoints.
 *
 * Body: { barcode: string, name: string }
 * Returns: { product: { id, name, categ_id, uom_id, barcode, active } }
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

// Process-level cache for the default category and UOM IDs.
let _defaultCategId: number | null = null;
let _defaultUomId: number | null = null;

async function getDefaultCategId(): Promise<number> {
  if (_defaultCategId !== null) return _defaultCategId;
  const odoo = getOdoo();
  const rows = await odoo.searchRead(
    'product.category',
    [['name', '=', 'All']],
    ['id'],
    { limit: 1 },
  );
  if (rows.length === 0) {
    throw new Error("Default category 'All' not found — configure in Odoo");
  }
  const id = rows[0].id as number;
  _defaultCategId = id;
  return id;
}

async function getDefaultUomId(): Promise<number> {
  if (_defaultUomId !== null) return _defaultUomId;
  const odoo = getOdoo();
  const rows = await odoo.searchRead(
    'uom.uom',
    [['name', '=', 'Units']],
    ['id'],
    { limit: 1 },
  );
  if (rows.length === 0) {
    throw new Error("Default UOM 'Units' not found — configure in Odoo");
  }
  const id = rows[0].id as number;
  _defaultUomId = id;
  return id;
}

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get('category_id');
  const search = searchParams.get('search');
  const ids = searchParams.get('ids');
  const limit = parseInt(searchParams.get('limit') || '200');

  try {
    const odoo = getOdoo();
    const domain: any[] = [
      ['type', '=', 'consu'],
      ['available_in_pos', '=', false],
    ];

    // Filter by explicit product IDs (from counting template)
    if (ids) {
      const idList = ids.split(',').map(Number).filter(n => !isNaN(n) && n > 0);
      if (idList.length > 0) {
        domain.push(['id', 'in', idList]);
      }
    }

    if (categoryId) domain.push(['categ_id', '=', parseInt(categoryId)]);
    if (search) domain.push(['name', 'ilike', search]);

    const products = await odoo.searchRead('product.product', domain,
      ['id', 'name', 'categ_id', 'uom_id', 'type', 'barcode', 'active', 'available_in_pos'],
      { limit, order: 'categ_id, name', context: { active_test: false } }
    );

    return NextResponse.json({ products });
  } catch (err: any) {
    console.error('Inventory products error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const barcode = (body.barcode || '').trim();
    const name = (body.name || '').trim();

    if (!barcode || barcode.length < 4) {
      return NextResponse.json({ error: 'barcode must be at least 4 chars' }, { status: 400 });
    }
    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'name must be at least 2 chars' }, { status: 400 });
    }

    const odoo = getOdoo();

    // Reject if the barcode already exists on any product — active or
    // inactive, POS or non-POS. We don't want to orphan a POS product's
    // barcode by creating a duplicate.
    const existing = await odoo.searchRead(
      'product.product',
      [['barcode', '=', barcode]],
      ['id', 'name', 'active', 'available_in_pos'],
      { limit: 1, context: { active_test: false } },
    );
    if (existing.length > 0) {
      const hint = existing[0].available_in_pos ? ' (POS item)' : '';
      return NextResponse.json(
        { error: `Barcode already exists on product: ${existing[0].name}${hint}` },
        { status: 409 },
      );
    }

    const categId = await getDefaultCategId();
    const uomId = await getDefaultUomId();

    const newId = await odoo.create('product.product', {
      name,
      barcode,
      categ_id: categId,
      uom_id: uomId,
      uom_po_id: uomId,
      type: 'consu',
      active: false,
    });

    // Re-read to return a consistent shape with GET response
    const rows = await odoo.searchRead(
      'product.product',
      [['id', '=', newId]],
      ['id', 'name', 'categ_id', 'uom_id', 'type', 'barcode', 'active', 'available_in_pos'],
      { limit: 1, context: { active_test: false } },
    );

    return NextResponse.json({ product: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
