/**
 * /api/purchase/guides
 * GET    - get guide for a supplier+location
 * POST   - add item to guide (manager+)
 * DELETE - remove item OR delete entire guide (manager+)
 * PATCH  - update item price (manager+)
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getGuideWithItems, getGuide, createGuide, addGuideItem, removeGuideItem, updateGuideItemPrice, reorderGuideItems, getCompanyForPurchaseLocation } from '@/lib/purchase-db';
import { initInventoryTables, getProductPar, setProductPar } from '@/lib/inventory-db';
import { canAccessPurchaseLocation, isUnrestrictedAdmin } from '@/lib/purchase-access';
import { getDb } from '@/lib/db';
import { moduleForbidden } from '@/lib/module-access';

export async function GET(request: Request) {
  const denied = moduleForbidden('purchase');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const supplierId = parseInt(searchParams.get('supplier_id') || '0');
  const locationId = parseInt(searchParams.get('location_id') || '0');

  if (!supplierId || !locationId) {
    return NextResponse.json({ error: 'supplier_id and location_id required' }, { status: 400 });
  }
  if (!canAccessPurchaseLocation(user, locationId)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const guide = getGuideWithItems(supplierId, locationId);

  // PAR COMES FROM PRODUCT SETTINGS, not from the guide's own column.
  //
  // purchase_guide_items still has a par_level of its own, and that is the
  // problem: the same product could carry 20 there and 15 in product settings
  // with nothing to say which is right. Product settings is the single source
  // of truth, so the guide reads from it and its column is ignored. (Nothing
  // was lost in the change — every existing guide row had par_level 0.)
  if (guide && Array.isArray(guide.items) && guide.items.length > 0) {
    const companyId = getCompanyForPurchaseLocation(locationId);
    if (companyId != null) {
      initInventoryTables();
      const ids = guide.items.map((i: { product_id: number }) => i.product_id);
      const parById = new Map(
        getProductPar(companyId, ids).map((r) => [r.odoo_product_id, r]),
      );
      guide.items = guide.items.map((i: { product_id: number }) => {
        const par = parById.get(i.product_id);
        return {
          ...i,
          // par_level kept for callers that still read it — it now means "the
          // least you want", which is what it was always used as.
          par_level: par?.par_min ?? 0,
          par_min: par?.par_min ?? null,
          par_max: par?.par_max ?? null,
        };
      });
    }
  }

  return NextResponse.json({ guide });
}

export async function POST(request: Request) {
  const denied = moduleForbidden('purchase');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'purchase.guide.manage', getPermissionOverrides())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const { supplier_id, location_id, product_id, product_name, product_uom, price, price_source, category_name, par_level, product_code } = body;

  if (!supplier_id || !location_id || !product_id) {
    return NextResponse.json({ error: 'supplier_id, location_id, product_id required' }, { status: 400 });
  }
  if (!canAccessPurchaseLocation(user, Number(location_id))) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  let guide = getGuide(supplier_id, location_id);
  if (!guide) {
    const guideId = createGuide(supplier_id, location_id, '');
    guide = { id: guideId };
  }

  const itemId = addGuideItem(guide.id, {
    product_id, product_name: product_name || '', product_uom: product_uom || 'Units',
    price: price || 0, price_source: price_source || 'manual', category_name: category_name || '',
    par_level: typeof par_level === 'number' ? par_level : 0,
    product_code: typeof product_code === 'string' ? product_code : '',
  });

  // A par typed here must land where par actually LIVES. It was still being
  // written only to purchase_guide_items.par_level, which the GET above no
  // longer reads — so a manager's number vanished on the very next load.
  if (typeof par_level === 'number' && par_level > 0) {
    const companyId = getCompanyForPurchaseLocation(location_id);
    if (companyId != null) {
      initInventoryTables();
      const existing = getProductPar(companyId, [product_id])[0];
      // Never overwrite a par already set in product settings — that screen is
      // the source of truth, and this is a convenience field beside it.
      if (!existing || (existing.par_min == null && existing.par_max == null)) {
        try { setProductPar(product_id, companyId, par_level, existing?.par_max ?? null, user.id); }
        catch (e) { console.warn('[purchase] could not store par for', product_id, e); }
      }
    }
  }

  return NextResponse.json({ id: itemId, message: 'Item added to guide' }, { status: 201 });
}

export async function DELETE(request: Request) {
  const denied = moduleForbidden('purchase');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'purchase.guide.manage', getPermissionOverrides())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const itemId = parseInt(searchParams.get('item_id') || '0');
  const guideId = parseInt(searchParams.get('guide_id') || '0');
  const supplierId = parseInt(searchParams.get('supplier_id') || '0');
  const locationId = parseInt(searchParams.get('location_id') || '0');

  const db = getDb();

  const locOfItem = (id: number) => (db.prepare('SELECT g.location_id AS loc FROM purchase_guide_items i JOIN purchase_order_guides g ON g.id = i.guide_id WHERE i.id = ?').get(id) as { loc: number } | undefined);
  const locOfGuide = (id: number) => (db.prepare('SELECT location_id AS loc FROM purchase_order_guides WHERE id = ?').get(id) as { loc: number } | undefined);

  // Delete single item
  if (itemId) {
    const r = locOfItem(itemId);
    if (!r || !canAccessPurchaseLocation(user, r.loc)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    removeGuideItem(itemId);
    return NextResponse.json({ message: 'Item removed' });
  }

  // Delete by guide_id
  if (guideId) {
    const r = locOfGuide(guideId);
    if (!r || !canAccessPurchaseLocation(user, r.loc)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const itemsDel = db.prepare('DELETE FROM purchase_guide_items WHERE guide_id = ?').run(guideId);
    const guideDel = db.prepare('DELETE FROM purchase_order_guides WHERE id = ?').run(guideId);
    return NextResponse.json({
      message: 'Order list deleted',
      debug: { items_deleted: itemsDel.changes, guides_deleted: guideDel.changes }
    });
  }

  // Company-scope: a location-scoped delete requires access to that restaurant;
  // the supplier-wide (no-location) branch is destructive across ALL companies →
  // admin only.
  if (supplierId) {
    if (locationId) { if (!canAccessPurchaseLocation(user, locationId)) return NextResponse.json({ error: 'Access denied' }, { status: 403 }); }
    else if (!isUnrestrictedAdmin(user)) return NextResponse.json({ error: 'Only an unrestricted admin can remove a supplier guide across all restaurants' }, { status: 403 });
  }
  // Delete by supplier_id (with or without location)
  if (supplierId) {
    // Step 1: Find ALL guide IDs for this supplier (any location)
    const guides = db.prepare(
      locationId
        ? 'SELECT id FROM purchase_order_guides WHERE supplier_id = ? AND location_id = ?'
        : 'SELECT id FROM purchase_order_guides WHERE supplier_id = ?'
    ).all(...(locationId ? [supplierId, locationId] : [supplierId])) as any[];

    const guideIds = guides.map((g: any) => g.id);
    let itemsDeleted = 0;
    let guidesDeleted = 0;

    // Step 2: Delete items for each guide
    for (const gid of guideIds) {
      const r = db.prepare('DELETE FROM purchase_guide_items WHERE guide_id = ?').run(gid);
      itemsDeleted += r.changes;
    }

    // Step 3: Delete the guide rows themselves
    if (locationId) {
      const r = db.prepare('DELETE FROM purchase_order_guides WHERE supplier_id = ? AND location_id = ?').run(supplierId, locationId);
      guidesDeleted += r.changes;
    } else {
      const r = db.prepare('DELETE FROM purchase_order_guides WHERE supplier_id = ?').run(supplierId);
      guidesDeleted += r.changes;
    }

    // Step 4: Nuclear cleanup — delete any orphaned items that somehow survived
    const orphans = db.prepare(
      'DELETE FROM purchase_guide_items WHERE guide_id NOT IN (SELECT id FROM purchase_order_guides)'
    ).run();

    return NextResponse.json({
      message: 'Order list deleted',
      debug: {
        guide_ids_found: guideIds,
        items_deleted: itemsDeleted,
        guides_deleted: guidesDeleted,
        orphans_cleaned: orphans.changes,
      }
    });
  }

  return NextResponse.json({ error: 'item_id, guide_id, or supplier_id required' }, { status: 400 });
}

export async function PATCH(request: Request) {
  const denied = moduleForbidden('purchase');
  if (denied) return denied;

  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'purchase.guide.manage', getPermissionOverrides())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const db = getDb();
  const itemLoc = (id: number) => (db.prepare('SELECT g.location_id AS loc FROM purchase_guide_items i JOIN purchase_order_guides g ON g.id = i.guide_id WHERE i.id = ?').get(id) as { loc: number } | undefined);

  // Reorder guide items into a custom walk-in order. EVERY supplied id must be a
  // clean positive integer AND resolve to an existing item in a restaurant the
  // caller may touch — reject the whole request otherwise. Validate the RAW
  // value (no lossy parseInt: "7.5"/"7junk" must NOT coerce to 7), and never
  // silently reorder a valid subset while a foreign/invalid id rides along.
  if (Array.isArray(body.item_ids)) {
    const ids: number[] = [];
    for (const raw of body.item_ids) {
      const n = typeof raw === 'number'
        ? raw
        : (typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? parseInt(raw, 10) : NaN);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json({ error: 'Invalid item id' }, { status: 400 });
      }
      ids.push(n);
    }
    // A reorder is a permutation of ONE guide's items — duplicate ids are
    // malformed input.
    if (new Set(ids).size !== ids.length) return NextResponse.json({ error: 'Duplicate item id' }, { status: 400 });
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT i.id AS id, i.guide_id AS gid, g.location_id AS loc FROM purchase_guide_items i JOIN purchase_order_guides g ON g.id = i.guide_id WHERE i.id IN (${placeholders})`).all(...ids) as { id: number; gid: number; loc: number }[];
      const found = new Set(rows.map((r) => r.id));
      if (found.size !== new Set(ids).size) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      // Authorize BEFORE reporting any structural detail (don't leak how ids relate).
      if (rows.some((r) => !canAccessPurchaseLocation(user, r.loc))) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      // All items must belong to the SAME guide — reordering across guides is
      // meaningless and would let one request touch several lists at once.
      const gid = rows[0].gid;
      if (new Set(rows.map((r) => r.gid)).size > 1) return NextResponse.json({ error: 'Items span multiple lists' }, { status: 400 });
      // A reorder is a full permutation: the supplied ids must be EXACTLY the
      // guide's items, else reorderGuideItems leaves omitted rows with stale
      // sort_order (duplicate positions).
      const total = (db.prepare('SELECT COUNT(*) AS n FROM purchase_guide_items WHERE guide_id = ?').get(gid) as { n: number }).n;
      if (total !== ids.length) return NextResponse.json({ error: 'Reorder must include every item on the list' }, { status: 400 });
    }
    reorderGuideItems(ids);
    return NextResponse.json({ message: 'Reordered' });
  }

  const { item_id, price, price_source } = body;
  if (!item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 });
  const r = itemLoc(item_id);
  if (!r || !canAccessPurchaseLocation(user, r.loc)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  updateGuideItemPrice(item_id, price, price_source || 'manual');
  return NextResponse.json({ message: 'Price updated' });
}
