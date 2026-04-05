import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';

/**
 * GET /api/companies
 * Returns companies the current portal user is allowed to access.
 * - Admin: sees all companies from Odoo
 * - Staff/Manager: sees only their assigned companies (allowed_company_ids)
 * - No assignment: empty list (admin must assign)
 */
export async function GET() {
  try {
    const user = requireAuth();
    const odoo = getOdoo();

    // Fetch all companies + warehouses from Odoo
    const companies = await odoo.searchRead('res.company', [], [
      'id', 'name', 'sequence',
    ], { limit: 50, order: 'sequence asc, id asc' });

    const warehouses = await odoo.searchRead('stock.warehouse', [], [
      'id', 'name', 'company_id', 'code', 'lot_stock_id',
    ], { limit: 50 });

    // Build enriched company list
    let enriched = companies.map((c: any) => {
      const wh = warehouses.find((w: any) => w.company_id[0] === c.id);
      return {
        id: c.id,
        name: c.name,
        sequence: c.sequence,
        warehouse_id: wh?.id || null,
        warehouse_name: wh?.name || null,
        warehouse_code: wh?.code?.trim() || null,
        stock_location_id: wh?.lot_stock_id?.[0] || null,
      };
    });

    // Filter by portal user's allowed companies (admin sees all)
    if (user.role !== 'admin') {
      const allowed = parseCompanyIds(user.allowed_company_ids);
      if (allowed.length > 0) {
        enriched = enriched.filter(c => allowed.includes(c.id));
      } else {
        // No companies assigned = empty (admin must assign)
        enriched = [];
      }
    }

    return NextResponse.json({ companies: enriched });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('GET /api/companies error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch companies' },
      { status: 500 }
    );
  }
}
