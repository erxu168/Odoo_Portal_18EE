import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/companies
 * Returns allowed companies for the portal user with warehouse/stock location mapping.
 * Data comes from Odoo: res.company (via session) + stock.warehouse.
 */
export async function GET() {
  try {
    const odoo = getOdoo();

    // Get all companies the Odoo user has access to
    const companies = await odoo.searchRead('res.company', [], [
      'id', 'name', 'sequence',
    ], { limit: 50, order: 'sequence asc, id asc' });

    // Get warehouse mapping (company -> warehouse -> stock location)
    const warehouses = await odoo.searchRead('stock.warehouse', [], [
      'id', 'name', 'company_id', 'code', 'lot_stock_id',
    ], { limit: 50 });

    // Build enriched company list
    const enriched = companies.map((c: any) => {
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

    return NextResponse.json({ companies: enriched });
  } catch (error: any) {
    console.error('GET /api/companies error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch companies' },
      { status: 500 }
    );
  }
}
