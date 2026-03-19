/**
 * GET /api/inventory/locations
 *
 * Proxies stock.location (internal) from Odoo 18 EE.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const odoo = getOdoo();
    const locations = await odoo.searchRead('stock.location',
      [['usage', '=', 'internal']],
      ['id', 'name', 'complete_name', 'barcode'],
      { order: 'complete_name' }
    );
    return NextResponse.json({ locations });
  } catch (err: any) {
    console.error('Inventory locations error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
