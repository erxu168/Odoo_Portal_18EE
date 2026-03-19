import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/purchase/guides
 *
 * Returns purchase lists grouped by supplier.
 * Each list = one supplier's order guide.
 * Maps to: purchase.list + purchase.list.line + res.partner
 */
export async function GET() {
  try {
    const odoo = getOdoo();

    // Fetch active purchase lists with their supplier info
    const lists = await odoo.searchRead(
      'purchase.list',
      [['active', '=', true]],
      ['name', 'description', 'partner_id', 'line_ids', 'company_id'],
      { order: 'name asc' }
    );

    // Collect unique partner IDs
    const partnerIds = [...new Set(
      lists
        .filter((l: any) => l.partner_id)
        .map((l: any) => l.partner_id[0])
    )] as number[];

    // Fetch supplier details (contact info, min order value)
    let partners: Record<number, any> = {};
    if (partnerIds.length > 0) {
      const partnerRecords = await odoo.read(
        'res.partner',
        partnerIds,
        ['name', 'phone', 'email', 'min_order_value']
      );
      for (const p of partnerRecords) {
        partners[p.id] = p;
      }
    }

    // Build response — one entry per purchase list (= one per supplier)
    const guides = lists.map((pl: any) => {
      const partnerId = pl.partner_id ? pl.partner_id[0] : null;
      const partner = partnerId ? partners[partnerId] : null;
      return {
        id: pl.id,
        name: pl.name,
        description: pl.description || '',
        lineCount: pl.line_ids?.length || 0,
        supplier: partner ? {
          id: partner.id,
          name: partner.name,
          phone: partner.phone || '',
          email: partner.email || '',
          minOrderValue: partner.min_order_value || 0,
        } : null,
      };
    });

    return NextResponse.json({ guides });
  } catch (err: any) {
    console.error('[API] GET /purchase/guides error:', err.message);
    return NextResponse.json(
      { error: 'Failed to load order guides', detail: err.message },
      { status: 500 }
    );
  }
}
