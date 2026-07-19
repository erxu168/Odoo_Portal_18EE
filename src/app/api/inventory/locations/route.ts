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
import { companyScope } from '@/lib/inventory-access';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const activeCompany = parseInt(searchParams.get('company_id') || '0', 10);
  // undefined = unrestricted admin; a non-admin with no companies gets NO
  // locations (never all — the old empty-allowed fell through to no filter).
  const scope = companyScope(user);
  if (scope && scope.length === 0) return NextResponse.json({ locations: [] });

  try {
    const odoo = getOdoo();

    const domain: any[] = [['usage', '=', 'internal']];
    if (scope) {
      if (activeCompany && scope.includes(activeCompany)) domain.push(['company_id', '=', activeCompany]);
      else domain.push(['company_id', 'in', scope]);
    } else if (activeCompany) {
      // Unrestricted admin: optional single-company narrow from the top-bar switcher.
      domain.push(['company_id', '=', activeCompany]);
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
