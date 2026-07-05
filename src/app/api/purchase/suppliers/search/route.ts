/**
 * /api/purchase/suppliers/search
 * GET - Search Odoo's res.partner for suppliers (supplier_rank > 0)
 * Live search against Odoo — not the local SQLite database.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(searchParams.get('limit') || '200') || 200, 500);

  try {
    const odoo = getOdoo();

    // Empty q -> full active-supplier list (browsable by default). A non-empty q
    // filters by name. supplier_rank > 0 keeps it to vendors only.
    const domain: any[] = [
      ['supplier_rank', '>', 0],
      ['active', '=', true],
    ];
    if (q.length >= 1) domain.push(['name', 'ilike', q]);

    const partners = await odoo.searchRead('res.partner', domain, [
      'id', 'name', 'email', 'phone', 'mobile',
    ], { limit, offset: 0, order: 'name asc' });

    // Check which ones already exist in local DB
    const { getDb } = await import('@/lib/db');
    const db = getDb();
    const existing = db.prepare(
      'SELECT odoo_partner_id FROM purchase_suppliers WHERE active = 1'
    ).all() as any[];
    const existingIds = new Set(existing.map((e: any) => e.odoo_partner_id));

    const suppliers = partners.map((p: any) => ({
      odoo_id: p.id,
      name: p.name,
      email: p.email || '',
      phone: p.phone || p.mobile || '',
      already_added: existingIds.has(p.id),
    }));

    return NextResponse.json({ suppliers });
  } catch (e: any) {
    console.error('Odoo supplier search error:', e);
    return NextResponse.json({ error: 'Failed to search Odoo', detail: e.message }, { status: 500 });
  }
}
