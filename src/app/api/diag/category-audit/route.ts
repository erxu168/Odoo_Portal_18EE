export const dynamic = 'force-dynamic';
/**
 * TEMPORARY one-off audit endpoint (token-gated) — read-only.
 * Pulls the product.category tree + product counts per category (active, POS,
 * archived) so the category sprawl can be analysed. REMOVE after the audit.
 */
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';

const TOKEN = 'cataudit-2607x';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('token') !== TOKEN) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const odoo = getOdoo();
    const categories = await odoo.searchRead('product.category', [], ['id', 'name', 'complete_name', 'parent_id'],
      { limit: 3000, order: 'complete_name' });
    // Active product.template count per category (lazy read_group → categ_id_count).
    const activeCounts = await odoo.call('product.template', 'read_group', [[], ['categ_id'], ['categ_id']], {});
    const posCounts = await odoo.call('product.template', 'read_group', [[['available_in_pos', '=', true]], ['categ_id'], ['categ_id']], {});
    const archivedCounts = await odoo.call('product.template', 'read_group',
      [[['active', '=', false]], ['categ_id'], ['categ_id']], { context: { active_test: false } });
    const totals = {
      categories: categories.length,
      activeProducts: await odoo.call('product.template', 'search_count', [[]], {}),
      posProducts: await odoo.call('product.template', 'search_count', [[['available_in_pos', '=', true]]], {}),
      archivedProducts: await odoo.call('product.template', 'search_count', [[['active', '=', false]]], { context: { active_test: false } }),
    };
    return NextResponse.json({ categories, activeCounts, posCounts, archivedCounts, totals });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
