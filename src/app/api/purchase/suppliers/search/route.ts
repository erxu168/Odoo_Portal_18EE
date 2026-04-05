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
  const q = searchParams.get('q') || '';
  const limit = parseInt(searchParams.get('limit') || '20');

  if (!q || q.length < 2) {
    return NextResponse.json({ suppliers: [], message: 'Enter at least 2 characters to search' });
  }

  try {
    const odoo = getOdoo();

    const domain = [
      ['supplier_rank', '>', 0],
      ['name', 'ilike', q],
      ['active', '=', true],
    ];

    const partners = await odoo.searchRead('res.partner', domain, [
      'id', 'name', 'email', 'phone', 'mobile',
    ], { limit, offset: 0, order: 'name asc' });

    // Check which ones already exist in local DB
    const { getDb } = await import('@/lib/db');
    const db = getDb();
    const existing = db.prepare(
      'SELECT odoo_partner_id FROM purchase_suppliers WHERE active = 1'
    ).all() as { odoo_partner_id: number }[];
    const existingIds = new Set(existing.map((e) => e.odoo_partner_id));

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
