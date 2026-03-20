/**
 * /api/purchase/tax
 * GET ?product_ids=1,2,3 - fetch tax rates from Odoo for given product IDs
 * Returns map: { product_id: tax_rate_percent }
 * Reads supplier_taxes_id (purchase taxes) from product.product,
 * then resolves the tax amount from account.tax.
 * Mirrors Odoo exactly — if no tax configured, returns 0%.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

// Cache tax rates for 1 hour (they rarely change)
const taxCache: Record<number, number> = {};
let taxCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const idsStr = searchParams.get('product_ids') || '';
  if (!idsStr) return NextResponse.json({ error: 'product_ids required' }, { status: 400 });

  const productIds = idsStr.split(',').map(Number).filter(n => n > 0);
  if (productIds.length === 0) return NextResponse.json({ taxes: {} });

  // Check cache
  const now = Date.now();
  const uncached = productIds.filter(id => !(id in taxCache) || now - taxCacheTime > CACHE_TTL);

  if (uncached.length > 0) {
    try {
      const odoo = getOdoo();

      // Get all account.tax records once (usually < 20)
      const allTaxes = await odoo.searchRead('account.tax', [], ['id', 'name', 'amount', 'type_tax_use', 'price_include'], { limit: 50 });
      const taxMap: Record<number, { amount: number; name: string }> = {};
      for (const t of (allTaxes || [])) {
        taxMap[t.id] = { amount: t.amount, name: t.name };
      }

      // Get supplier_taxes_id for uncached products
      const products = await odoo.searchRead('product.product',
        [['id', 'in', uncached]],
        ['id', 'supplier_taxes_id', 'taxes_id'],
        { limit: uncached.length }
      );

      for (const p of (products || [])) {
        // Prefer supplier_taxes_id (purchase tax), fall back to taxes_id (sales tax)
        const taxIds = (p.supplier_taxes_id?.length > 0 ? p.supplier_taxes_id : p.taxes_id) || [];
        if (taxIds.length > 0 && taxMap[taxIds[0]]) {
          taxCache[p.id] = taxMap[taxIds[0]].amount;
        } else {
          taxCache[p.id] = 0; // No tax configured in Odoo = 0%
        }
      }

      // Products not found in Odoo = 0%
      for (const id of uncached) {
        if (!(id in taxCache)) taxCache[id] = 0;
      }

      taxCacheTime = now;
    } catch (e) {
      console.error('Failed to fetch tax rates from Odoo:', e);
      // On error, default to 0% (don't assume tax)
      for (const id of uncached) {
        if (!(id in taxCache)) taxCache[id] = 0;
      }
    }
  }

  const result: Record<number, number> = {};
  for (const id of productIds) {
    result[id] = taxCache[id] ?? 0;
  }

  return NextResponse.json({ taxes: result });
}
