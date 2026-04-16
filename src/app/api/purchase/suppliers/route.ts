/**
 * /api/purchase/suppliers
 * GET    - list suppliers for a location
 * POST   - create a new supplier (manager+). Two modes:
 *           1) { odoo_partner_id, ... }              — link existing Odoo partner
 *           2) { create_in_odoo: true, name, ... }   — create res.partner in Odoo first, then link
 *          Re-activates a soft-deleted row if one already exists for the same odoo_partner_id.
 * PATCH  - update supplier (manager+)
 * DELETE - soft-delete supplier + cleanup its order guide (manager+)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { listSuppliers, createSupplier, updateSupplier, getSupplier } from '@/lib/purchase-db';
import { getDb } from '@/lib/db';
import { OdooClient } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get('location_id');
  const suppliers = listSuppliers(locationId ? parseInt(locationId) : undefined);

  // Count guide items per supplier
  const { getDb } = await import('@/lib/db');
  const db = getDb();
  const enriched = (suppliers as any[]).map(s => {
    const guideCount = db.prepare(
      'SELECT COUNT(*) as c FROM purchase_guide_items gi JOIN purchase_order_guides g ON g.id = gi.guide_id WHERE g.supplier_id = ? AND g.location_id = ?'
    ).get(s.id, locationId ? parseInt(locationId) : s.location_id) as any;
    return { ...s, product_count: guideCount?.c || 0 };
  });

  return NextResponse.json({ suppliers: enriched });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  let odoo_partner_id = body.odoo_partner_id;
  const { name, email, phone, create_in_odoo, send_method, min_order_value, order_days, lead_time_days, approval_required, location_id } = body;

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  // Mode 2: create the res.partner in Odoo first
  if (create_in_odoo && !odoo_partner_id) {
    try {
      const odoo = new OdooClient();
      await odoo.authenticate();
      const vals: Record<string, any> = {
        name,
        supplier_rank: 1,
        email: email || false,
        phone: phone || false,
        is_company: true,
      };
      odoo_partner_id = await odoo.create('res.partner', vals);
    } catch (e: any) {
      console.error('[purchase/suppliers POST] Odoo create failed', e);
      return NextResponse.json({ error: 'Failed to create partner in Odoo', detail: e.message }, { status: 502 });
    }
  }

  if (!odoo_partner_id) {
    return NextResponse.json({ error: 'odoo_partner_id or create_in_odoo:true is required' }, { status: 400 });
  }

  // De-dup: if a portal supplier already exists for this Odoo partner (active or soft-deleted), reuse it
  const db = getDb();
  const existing = db
    .prepare('SELECT id, active FROM purchase_suppliers WHERE odoo_partner_id = ? ORDER BY active DESC, id DESC LIMIT 1')
    .get(odoo_partner_id) as { id: number; active: number } | undefined;

  if (existing) {
    const patch: Record<string, any> = {};
    if (!existing.active) patch.active = 1;
    if (name) patch.name = name;
    if (email !== undefined) patch.email = email || '';
    if (phone !== undefined) patch.phone = phone || '';
    if (send_method) patch.send_method = send_method;
    if (Object.keys(patch).length) updateSupplier(existing.id, patch);
    return NextResponse.json({
      id: existing.id,
      odoo_partner_id,
      message: existing.active ? 'Supplier already linked — details refreshed' : 'Supplier re-activated',
      reactivated: !existing.active,
    });
  }

  const id = createSupplier({
    odoo_partner_id, name, email: email || '', phone: phone || '',
    send_method: send_method || 'email', min_order_value, order_days,
    lead_time_days, approval_required, location_id,
  });

  return NextResponse.json({ id, odoo_partner_id, message: 'Supplier created' }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const existing = getSupplier(id);
  if (!existing) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  updateSupplier(id, updates);
  return NextResponse.json({ message: 'Supplier updated' });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get('id') || '0');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const existing = getSupplier(id);
  if (!existing) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  const db = getDb();

  const guides = db.prepare('SELECT id FROM purchase_order_guides WHERE supplier_id = ?').all(id) as { id: number }[];
  let itemsDeleted = 0;
  for (const g of guides) {
    const r = db.prepare('DELETE FROM purchase_guide_items WHERE guide_id = ?').run(g.id);
    itemsDeleted += r.changes;
  }
  const guidesDeleted = db.prepare('DELETE FROM purchase_order_guides WHERE supplier_id = ?').run(id).changes;

  // Soft-delete: keeps referential integrity with purchase_orders / purchase_carts
  updateSupplier(id, { active: 0 });

  return NextResponse.json({
    message: 'Supplier removed',
    debug: { guides_deleted: guidesDeleted, items_deleted: itemsDeleted },
  });
}
