/**
 * GET /api/inventory/locations
 *
 * Proxies stock.location (internal) from Odoo 18 EE.
 * If `?company_id=` is provided, filters to that single active company
 * (matches the company selector in the top bar). Otherwise falls back
 * to the user's full allowed_company_ids list.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { parseCompanyIds } from '@/lib/db';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const activeCompany = parseInt(searchParams.get('company_id') || '0', 10);

  try {
    const odoo = getOdoo();

    const domain: any[] = [['usage', '=', 'internal']];
    const allowedIds = parseCompanyIds(user.allowed_company_ids);

    if (activeCompany && allowedIds.includes(activeCompany)) {
      domain.push(['company_id', '=', activeCompany]);
    } else if (allowedIds.length > 0) {
      domain.push(['company_id', 'in', allowedIds]);
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
