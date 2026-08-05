/**
 * GET /api/purchase/products
 * Search Odoo products for adding to order guides.
 * Params: ?q=search_term&category=Food&limit=30
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { initPurchaseTables, getSupplierOdooPartnerId } from '@/lib/purchase-db';
import { indexSupplierPrices, resolveBuyPrice } from '@/lib/purchase-price';
import { moduleForbidden } from '@/lib/module-access';

export async function GET(request: Request) {
  const denied = moduleForbidden('purchase');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'purchase.product.manage', getPermissionOverrides())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const limit = parseInt(searchParams.get('limit') || '40');
  const offset = parseInt(searchParams.get('offset') || '0') || 0;
  // The order guide belongs to ONE supplier, so "what does this cost" has an
  // answer — theirs. Optional, because this search is also used where no supplier
  // is in play; without it the price falls back to our own cost.
  const rawSupplier = searchParams.get('supplier_id');
  const portalSupplierId = rawSupplier && /^\d+$/.test(rawSupplier) ? parseInt(rawSupplier, 10) : null;

  try {
    const odoo = getOdoo();

    // Build domain filter
    const domain: any[] = [];
    if (q) {
      domain.push(['name', 'ilike', q]);
    }
    if (category && category !== 'All') {
      domain.push(['categ_id.name', 'ilike', category]);
    }

    const products = await odoo.searchRead('product.product',
      domain,
      // standard_price and product_tmpl_id replace the reliance on list_price:
      // one is our cost, the other is how a supplier price is attached.
      ['id', 'name', 'uom_id', 'categ_id', 'list_price', 'standard_price', 'product_tmpl_id', 'type', 'active'],
      { limit, offset, order: 'categ_id, name' }
    );

    // THE FIX. This route reported `list_price` — the price you SELL at — as the
    // order guide price. Almost nothing here has one set, so Odoo's default of
    // 1.00 stood in and the guide read €1.00 for essentially every product, while
    // the real numbers sat on product.supplierinfo: 515 of 601 catalog products
    // have a supplier price, and only 8 have a cost.
    let partnerId: number | null = null;
    if (portalSupplierId != null) {
      initPurchaseTables();
      partnerId = getSupplierOdooPartnerId(portalSupplierId);
    }
    const ids = (products as { id: number }[]).map((p) => p.id);
    const tmplIds = (products as { product_tmpl_id?: [number, string] }[])
      .map((p) => (Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[0] : null))
      .filter((n): n is number => n != null);
    // A supplierinfo row hangs off the VARIANT or the TEMPLATE — usually the
    // template — so both are asked for, or most prices are missed.
    const sellerRows = ids.length > 0
      ? await odoo.searchRead('product.supplierinfo',
          ['|', ['product_id', 'in', ids], ['product_tmpl_id', 'in', tmplIds]],
          ['product_id', 'product_tmpl_id', 'partner_id', 'price', 'min_qty'],
          { limit: 2000 })
      : [];
    const priceIndex = indexSupplierPrices(sellerRows as any[], partnerId ?? undefined);

    // Also fetch categories for filter pills
    const categories = await odoo.searchRead('product.category',
      [['parent_id', '!=', false]],
      ['id', 'name', 'complete_name'],
      { limit: 50, order: 'name' }
    );

    // Common units for the "create new product" form (curated subset of uom.uom).
    const COMMON_UNITS = ['Units', 'kg', 'g', 'mg', 'L', 'ml', 'Dozen', 'lb', 'oz', 't'];
    const uomRows = await odoo.searchRead('uom.uom', [], ['id', 'name'], { limit: 300 });
    const units = (uomRows as any[])
      .filter((u) => COMMON_UNITS.includes(u.name))
      .map((u) => ({ id: u.id, name: u.name }))
      .sort((a, b) => COMMON_UNITS.indexOf(a.name) - COMMON_UNITS.indexOf(b.name));

    const formatted = (products || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      uom: p.uom_id?.[1] || 'Units',
      category_id: p.categ_id?.[0] || 0,
      category_name: p.categ_id?.[1]?.split(' / ').pop() || 'Other',
      // What we PAY, never what we would charge. See lib/purchase-price.ts.
      ...(() => {
        const r = resolveBuyPrice(p, priceIndex);
        return { price: r.price, price_source: r.source, price_from: r.supplier_name || null };
      })(),
      type: p.type,
    }));

    const categoryList = (categories || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      full_name: c.complete_name,
    }));

    return NextResponse.json({ products: formatted, categories: categoryList, units });
  } catch (e: any) {
    console.error('Failed to search Odoo products:', e);
    return NextResponse.json({ error: e.message || 'Failed to search products', products: [], categories: [] }, { status: 500 });
  }
}
