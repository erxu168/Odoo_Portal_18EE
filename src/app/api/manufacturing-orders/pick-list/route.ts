import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

/**
 * GET /api/manufacturing-orders/pick-list
 * Returns aggregated component needs from all confirmed MOs,
 * grouped by product category. Supports ?company_id=X filter.
 */
export async function GET(request: Request) {
  try {
    const odoo = getOdoo();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('company_id');

    const moDomain: any[] = [['state', '=', 'confirmed']];
    if (companyId) {
      moDomain.push(['company_id', '=', parseInt(companyId)]);
    }

    const mos = await odoo.searchRead('mrp.production', moDomain,
      ['name', 'product_id', 'product_qty', 'move_raw_ids'],
      { limit: 200, order: 'id asc' }
    );

    if (mos.length === 0) {
      return NextResponse.json({ items: [], categories: [], mo_count: 0 });
    }

    const allMoveIds: number[] = [];
    for (const mo of mos) {
      if (mo.move_raw_ids?.length) allMoveIds.push(...mo.move_raw_ids);
    }

    if (allMoveIds.length === 0) {
      return NextResponse.json({ items: [], categories: [], mo_count: mos.length });
    }

    const moves = await odoo.searchRead('stock.move',
      [['id', 'in', allMoveIds]],
      ['product_id', 'product_uom_qty', 'quantity', 'product_uom', 'raw_material_production_id', 'picked', 'state'],
      { limit: 2000 }
    );

    const productMap: Record<number, {
      product_id: number;
      product_name: string;
      uom: string;
      total_demand: number;
      total_picked: number;
      mo_names: string[];
      mo_count: number;
    }> = {};

    const moNameMap: Record<number, string> = {};
    for (const mo of mos) moNameMap[mo.id] = mo.name;

    for (const m of moves) {
      const pid = m.product_id[0];
      const pname = m.product_id[1];
      const moId = m.raw_material_production_id?.[0];
      const moName = moId ? (moNameMap[moId] || `MO#${moId}`) : '';

      if (!productMap[pid]) {
        productMap[pid] = {
          product_id: pid,
          product_name: pname,
          uom: m.product_uom?.[1] || 'Units',
          total_demand: 0,
          total_picked: 0,
          mo_names: [],
          mo_count: 0,
        };
      }
      productMap[pid].total_demand += m.product_uom_qty || 0;
      if (m.picked) productMap[pid].total_picked += m.quantity || 0;
      if (moName && !productMap[pid].mo_names.includes(moName)) {
        productMap[pid].mo_names.push(moName);
        productMap[pid].mo_count++;
      }
    }

    const productIds = Object.keys(productMap).map(Number);
    const products = await odoo.searchRead('product.product',
      [['id', 'in', productIds]],
      ['id', 'categ_id'],
      { limit: 2000 }
    );

    const categMap: Record<number, string> = {};
    for (const p of products) {
      const fullName = p.categ_id?.[1] || 'Uncategorized'; const parts = fullName.split(' / '); categMap[p.id] = parts[parts.length - 1];
    }

    const items = Object.values(productMap).map(item => ({
      ...item,
      category: categMap[item.product_id] || 'Uncategorized',
      remaining: Math.max(0, item.total_demand - item.total_picked),
    }));

    items.sort((a, b) => a.category.localeCompare(b.category) || a.product_name.localeCompare(b.product_name));

    const categories = Array.from(new Set(items.map(i => i.category))).sort();

    return NextResponse.json({
      items,
      categories,
      mo_count: mos.length,
      total_components: items.length,
    });
  } catch (error: any) {
    console.error('GET /api/manufacturing-orders/pick-list error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to build pick list' },
      { status: 500 }
    );
  }
}
