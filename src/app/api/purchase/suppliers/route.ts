/**
 * /api/purchase/suppliers
 * GET  - list suppliers for a location
 * POST - create a new supplier (admin only)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { listSuppliers, createSupplier, updateSupplier, getSupplier } from '@/lib/purchase-db';

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
  if (!hasRole(user, 'admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const { odoo_partner_id, name, email, phone, send_method, min_order_value, order_days, lead_time_days, approval_required, location_id } = body;

  if (!odoo_partner_id || !name) {
    return NextResponse.json({ error: 'odoo_partner_id and name are required' }, { status: 400 });
  }

  const id = createSupplier({
    odoo_partner_id, name, email: email || '', phone: phone || '',
    send_method: send_method || 'email', min_order_value, order_days,
    lead_time_days, approval_required, location_id,
  });

  return NextResponse.json({ id, message: 'Supplier created' }, { status: 201 });
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
