/**
 * GET /api/inventory/locations
 *
 * Proxies stock.location (internal) from Odoo 18 EE.
 * Filters by user's allowed_company_ids so staff only see
 * locations belonging to their companies.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { parseCompanyIds } from '@/lib/db';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const odoo = getOdoo();

    const domain: any[] = [['usage', '=', 'internal']];
    const companyIds = parseCompanyIds(user.allowed_company_ids);
    if (companyIds.length > 0) {
      domain.push(['company_id', 'in', companyIds]);
    }

    const locations = await odoo.searchRead('stock.location',
      domain,
      ['id', 'name', 'complete_name', 'barcode', 'company_id'],
      { order: 'complete_name' }
    );
    return NextResponse.json({ locations });
  } catch (err: any) {
    console.error('Inventory locations error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
