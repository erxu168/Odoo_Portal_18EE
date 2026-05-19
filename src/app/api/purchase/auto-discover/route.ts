/**
 * POST /api/purchase/auto-discover
 *
 * Auto-generates order guides ("order lists") from real Odoo purchase history.
 * For each company passed in (defaults: SSAM=3, What a Jerk=5):
 *   1. Ensures a `purchase_locations` row exists (self-introspects warehouse +
 *      picking_type from Odoo on first run if missing).
 *   2. Reads `purchase.order` rows for that company in the last N months
 *      (default 12) with state in ['purchase', 'done'] — i.e. confirmed POs,
 *      not drafts/cancels.
 *   3. Groups by partner_id to find every supplier we've actually ordered from.
 *   4. Reads `purchase.order.line` for those POs to collect the products ordered
 *      from each supplier, keeping the most recent unit price per product.
 *   5. Upserts portal suppliers (linking to res.partner) and creates/refreshes
 *      one order guide per (supplier, location), populated with the discovered
 *      products.
 *
 * Admin-only. Safe to re-run — existing suppliers are reused (de-duped on
 * odoo_partner_id) and existing guide items are not deleted; new products are
 * added, prices on existing items are refreshed to the most recent value.
 *
 * Body (all optional):
 *   { companies?: number[],         // Odoo res.company ids, default [3, 5]
 *     months?: number,              // PO history window, default 12
 *     dry_run?: boolean }           // if true, returns preview without writes
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { getDb } from '@/lib/db';
import {
  listSuppliers, createSupplier, getSupplier,
  getGuide, createGuide, addGuideItem,
  getLocationByCompany, upsertLocation,
  type PurchaseLocation,
} from '@/lib/purchase-db';

const DEFAULT_COMPANIES = [3, 5]; // SSAM Korean BBQ, What a Jerk

interface CompanyResult {
  company_id: number;
  company_name: string;
  location_id: number | null;
  location_name: string | null;
  po_count: number;
  suppliers_imported: number;
  suppliers_reused: number;
  items_added: number;
  items_refreshed: number;
  skipped: string[];
  error?: string;
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'admin')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const companies: number[] = Array.isArray(body.companies) && body.companies.length > 0
    ? body.companies.filter((c: any) => Number.isInteger(c) && c > 0)
    : DEFAULT_COMPANIES;
  const months = Number.isFinite(body.months) && body.months > 0 && body.months <= 60
    ? Math.floor(body.months) : 12;
  const dryRun = body.dry_run === true;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().replace('T', ' ').slice(0, 19);

  const odoo = getOdoo();
  const results: CompanyResult[] = [];

  // Fetch company names once for nicer reporting
  const companyRows = await odoo.searchRead('res.company',
    [['id', 'in', companies]], ['id', 'name'], { limit: companies.length });
  const companyName = new Map<number, string>();
  for (const c of companyRows as any[]) companyName.set(c.id, c.name);

  for (const companyId of companies) {
    const r: CompanyResult = {
      company_id: companyId,
      company_name: companyName.get(companyId) || `Company ${companyId}`,
      location_id: null,
      location_name: null,
      po_count: 0,
      suppliers_imported: 0,
      suppliers_reused: 0,
      items_added: 0,
      items_refreshed: 0,
      skipped: [],
    };

    try {
      const location = await ensureLocation(companyId, r.company_name, dryRun);
      if (!location) {
        r.error = 'No warehouse found for this company in Odoo';
        results.push(r);
        continue;
      }
      r.location_id = location.id;
      r.location_name = location.name;

      // 1. Find confirmed POs in window
      const pos = await odoo.searchRead('purchase.order',
        [
          ['company_id', '=', companyId],
          ['date_order', '>=', cutoffStr],
          ['state', 'in', ['purchase', 'done']],
        ],
        ['id', 'partner_id', 'date_order'],
        { limit: 5000, order: 'date_order desc' }
      );
      r.po_count = pos.length;
      if (pos.length === 0) {
        results.push(r);
        continue;
      }

      // 2. Group POs by partner. Track most-recent date per partner for ordering.
      const posByPartner = new Map<number, { ids: number[]; latestDate: string }>();
      for (const po of pos as any[]) {
        if (!po.partner_id) continue;
        const partnerId = po.partner_id[0];
        const bucket = posByPartner.get(partnerId);
        if (bucket) {
          bucket.ids.push(po.id);
          if (po.date_order > bucket.latestDate) bucket.latestDate = po.date_order;
        } else {
          posByPartner.set(partnerId, { ids: [po.id], latestDate: po.date_order });
        }
      }

      // 3. Fetch partner details for each
      const partnerIds = Array.from(posByPartner.keys());
      const partners = partnerIds.length > 0
        ? await odoo.read('res.partner', partnerIds, ['id', 'name', 'email', 'phone', 'mobile'])
        : [];
      const partnerById = new Map<number, any>();
      for (const p of partners as any[]) partnerById.set(p.id, p);

      // 4. Fetch all PO lines in one shot, then group by partner via order_id->partner map
      const allPoIds: number[] = [];
      const poIdToPartner = new Map<number, number>();
      for (const entry of Array.from(posByPartner.entries())) {
        const partnerId = entry[0];
        const info = entry[1];
        for (const poId of info.ids) {
          allPoIds.push(poId);
          poIdToPartner.set(poId, partnerId);
        }
      }
      const lines = allPoIds.length > 0
        ? await odoo.searchRead('purchase.order.line',
            [['order_id', 'in', allPoIds]],
            ['id', 'order_id', 'product_id', 'name', 'product_uom', 'price_unit', 'date_order'],
            { limit: 20000, order: 'date_order desc' })
        : [];

      // Deduplicate by (partnerId, productId), keeping most recent line (lines are
      // already date_order desc, so the first occurrence wins).
      interface DiscoveredProduct {
        product_id: number;
        product_name: string;
        product_uom: string;
        price: number;
        category_name: string;
      }
      const byPartner = new Map<number, Map<number, DiscoveredProduct>>();
      const productIdsToEnrich = new Set<number>();
      for (const ln of lines as any[]) {
        if (!ln.product_id || !ln.order_id) continue;
        const partnerId = poIdToPartner.get(ln.order_id[0]);
        if (!partnerId) continue;
        const productId = ln.product_id[0];
        let bucket = byPartner.get(partnerId);
        if (!bucket) { bucket = new Map(); byPartner.set(partnerId, bucket); }
        if (bucket.has(productId)) continue; // already kept most recent
        bucket.set(productId, {
          product_id: productId,
          product_name: ln.product_id[1] || ln.name || '',
          product_uom: ln.product_uom?.[1] || 'Units',
          price: typeof ln.price_unit === 'number' ? ln.price_unit : 0,
          category_name: '',
        });
        productIdsToEnrich.add(productId);
      }

      // 5. Enrich products with category names so the order guide groups nicely
      if (productIdsToEnrich.size > 0) {
        const productRows = await odoo.read('product.product',
          Array.from(productIdsToEnrich), ['id', 'categ_id']);
        const catByProduct = new Map<number, string>();
        for (const p of productRows as any[]) {
          const cat = Array.isArray(p.categ_id) ? p.categ_id[1] : '';
          catByProduct.set(p.id, typeof cat === 'string' ? cat.split(' / ').pop() || 'Other' : 'Other');
        }
        for (const bucket of Array.from(byPartner.values())) {
          for (const item of Array.from(bucket.values())) {
            item.category_name = catByProduct.get(item.product_id) || 'Other';
          }
        }
      }

      if (dryRun) {
        r.suppliers_imported = byPartner.size;
        r.items_added = Array.from(byPartner.values()).reduce((s, m) => s + m.size, 0);
        results.push(r);
        continue;
      }

      // 6. Upsert suppliers + guides + items
      const existingSuppliers = listSuppliers() as any[];
      const supplierByPartner = new Map<number, any>();
      for (const s of existingSuppliers) supplierByPartner.set(s.odoo_partner_id, s);

      for (const partnerId of partnerIds) {
        const partner = partnerById.get(partnerId);
        if (!partner) { r.skipped.push(`partner #${partnerId}: not found`); continue; }
        const products = byPartner.get(partnerId);
        if (!products || products.size === 0) continue;

        let supplier = supplierByPartner.get(partnerId);
        if (!supplier) {
          const newId = createSupplier({
            odoo_partner_id: partnerId,
            name: partner.name || `Vendor ${partnerId}`,
            email: partner.email || '',
            phone: partner.phone || partner.mobile || '',
            send_method: 'email',
            location_id: 0, // 0 = available for all locations
          });
          supplier = getSupplier(newId);
          if (supplier) supplierByPartner.set(partnerId, supplier);
          r.suppliers_imported += 1;
        } else {
          r.suppliers_reused += 1;
        }
        if (!supplier) continue;

        // Ensure a guide exists for this supplier+location
        const guide = getGuide(supplier.id, location.id);
        const guideId: number = guide
          ? guide.id
          : createGuide(supplier.id, location.id, `${supplier.name} - ${location.name}`);

        // Read existing items in the guide so we don't double-insert and can refresh prices
        const db = getDb();
        const existingItems = db.prepare(
          'SELECT id, product_id, price FROM purchase_guide_items WHERE guide_id = ?'
        ).all(guideId) as { id: number; product_id: number; price: number }[];
        const existingByProduct = new Map<number, { id: number; price: number }>();
        for (const it of existingItems) existingByProduct.set(it.product_id, it);

        for (const item of Array.from(products.values())) {
          const existing = existingByProduct.get(item.product_id);
          if (existing) {
            if (Math.abs(existing.price - item.price) > 0.001 && item.price > 0) {
              db.prepare(
                'UPDATE purchase_guide_items SET price = ?, price_source = ? WHERE id = ?'
              ).run(item.price, 'odoo', existing.id);
              r.items_refreshed += 1;
            }
            continue;
          }
          addGuideItem(guideId, {
            product_id: item.product_id,
            product_name: item.product_name,
            product_uom: item.product_uom,
            price: item.price,
            price_source: 'odoo',
            category_name: item.category_name || 'Other',
          });
          r.items_added += 1;
        }
      }
    } catch (e: unknown) {
      console.error('[auto-discover] company', companyId, e);
      r.error = e instanceof Error ? e.message : String(e);
    }

    results.push(r);
  }

  return NextResponse.json({
    message: dryRun ? 'Preview complete (no writes)' : 'Auto-import complete',
    months_window: months,
    cutoff_date: cutoffStr,
    results,
  });
}

/**
 * Ensure a portal location row exists for this Odoo company. If missing, query
 * Odoo for the company's first warehouse + its incoming picking type + main
 * stock location, and persist a new `purchase_locations` row keyed on the
 * stock.location.id (so existing data + LOCATIONS const stay consistent with
 * the SSAM=32 / GBM38=22 convention).
 */
async function ensureLocation(
  companyId: number,
  companyName: string,
  dryRun: boolean,
): Promise<PurchaseLocation | null> {
  const existing = getLocationByCompany(companyId);
  if (existing) return existing;

  const odoo = getOdoo();
  const warehouses = await odoo.searchRead('stock.warehouse',
    [['company_id', '=', companyId]],
    ['id', 'name', 'code', 'lot_stock_id', 'in_type_id'],
    { limit: 1, order: 'id asc' }
  );
  if (warehouses.length === 0) return null;
  const wh = warehouses[0] as any;

  const stockLocId: number | undefined = Array.isArray(wh.lot_stock_id) ? wh.lot_stock_id[0] : undefined;
  const pickingTypeId: number | undefined = Array.isArray(wh.in_type_id) ? wh.in_type_id[0] : undefined;
  if (!stockLocId) return null;

  // Friendly name: prefer the warehouse short code (e.g. "WAJ"), fall back to company name.
  const friendlyName = typeof wh.code === 'string' && wh.code.length > 0
    ? wh.code
    : companyName.replace(/\s+/g, '').slice(0, 12) || `Loc${companyId}`;

  if (dryRun) {
    // Return a transient location object so the rest of the pipeline can run in preview mode
    return {
      id: stockLocId,
      name: friendlyName,
      odoo_company_id: companyId,
      odoo_warehouse_id: wh.id,
      odoo_picking_type_id: pickingTypeId ?? null,
      sort_order: 99,
      created_at: new Date().toISOString(),
    };
  }

  upsertLocation({
    id: stockLocId,
    name: friendlyName,
    odoo_company_id: companyId,
    odoo_warehouse_id: wh.id,
    odoo_picking_type_id: pickingTypeId ?? null,
    sort_order: 99,
  });
  return getLocationByCompany(companyId) || null;
}
