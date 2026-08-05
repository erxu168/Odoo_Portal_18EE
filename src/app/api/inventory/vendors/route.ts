export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/vendors
 *
 * Returns active vendors from Odoo (res.partner with supplier_rank > 0).
 * Used by the draft-product approve panel to pick a supplier.
 * Optional ?search= narrows by name (ILIKE).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { moduleForbidden } from '@/lib/module-access';

export async function GET(request: Request) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.draft.review', getPermissionOverrides())) {
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
      // The product page renders the FULL supplier dropdown — a low limit
      // silently hid suppliers past the first page ("MC City" bug).
      { limit: 2000, order: 'name' },
    );
    // Placeholder/junk partners ("---", empty) only clutter a picker.
    const clean = (vendors || []).filter((v: any) => v.name && !/^[\s\-\u2013\u2014_.]*$/.test(String(v.name)));
    return NextResponse.json({ vendors: clean });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[vendors GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
