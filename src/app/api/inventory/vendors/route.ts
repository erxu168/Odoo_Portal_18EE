export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/vendors
 *
 * Returns active vendors from Odoo (res.partner with supplier_rank > 0).
 * Used by the draft-product approve panel to pick a supplier.
 * Optional ?search= narrows by name (ILIKE).
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const search = (searchParams.get('search') || '').trim();

  try {
    const odoo = getOdoo();
    const domain: any[] = [['supplier_rank', '>', 0], ['active', '=', true]];
    if (search) domain.push(['name', 'ilike', search]);

    const vendors = await odoo.searchRead(
      'res.partner',
      domain,
      ['id', 'name', 'email', 'phone'],
      { limit: 50, order: 'name' },
    );
    return NextResponse.json({ vendors });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[vendors GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
