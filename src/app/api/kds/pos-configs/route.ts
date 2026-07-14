import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * Lists the active Odoo POS registers so the KDS settings can offer a dropdown
 * instead of a raw numeric config ID. READ-ONLY against Odoo.
 */
export async function GET() {
  try {
    const odoo = getOdoo();
    const rows = await odoo.searchRead(
      'pos.config',
      [['active', '=', true]],
      ['id', 'name', 'company_id'],
      { order: 'name ASC', limit: 100 },
    );
    const configs = rows.map((c: { id: number; name: string; company_id: [number, string] | false }) => ({
      id: c.id,
      name: c.name,
      company: Array.isArray(c.company_id) ? c.company_id[1] : '',
    }));
    return NextResponse.json({ configs });
  } catch (err) {
    return NextResponse.json({
      configs: [],
      error: err instanceof Error ? err.message : 'Could not load POS registers',
    });
  }
}
