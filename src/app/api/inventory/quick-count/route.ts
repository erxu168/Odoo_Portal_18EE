export const dynamic = 'force-dynamic';
/**
 * /api/inventory/quick-count
 *
 * GET  — list quick counts (filter by status)
 *        Accepts 'submitted' as alias for 'pending' (for consistency with session statuses)
 * POST — submit a batch of quick counts
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initInventoryTables, createQuickCount, listQuickCounts, getProductFlags, setCountPhotos, getCountPhotosMap, getQuickCountLocationsMissingCompany, setQuickCountCompanyByLocation } from '@/lib/inventory-db';
import { companyScope, canAccessCompany } from '@/lib/inventory-access';
import { getOdoo } from '@/lib/odoo';
import { resolveAttribution } from '@/lib/shift-attribution';
import { crateTotal } from '@/lib/crate-units';

// Lazily stamp legacy quick counts (missing a company) from their Odoo location's
// company. Best-effort: if Odoo is unreachable the quarantine in listQuickCounts
// keeps un-backfilled rows hidden from non-admins.
async function backfillQuickCountCompanies(): Promise<void> {
  try {
    const missing = getQuickCountLocationsMissingCompany();
    if (missing.length === 0) return;
    const locs = await getOdoo().searchRead('stock.location', [['id', 'in', missing]], ['id', 'company_id'], { limit: missing.length });
    for (const l of locs as { id: number; company_id: [number, string] | false }[]) {
      const c = Array.isArray(l.company_id) ? l.company_id[0] : l.company_id;
      if (c) setQuickCountCompanyByLocation(l.id, c);
    }
  } catch (e) { console.warn('[krawings_inventory] quick-count company backfill skipped:', e); }
}


export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();
  await backfillQuickCountCompanies();

  const { searchParams } = new URL(request.url);
  let status = searchParams.get('status') || undefined;

  // Map 'submitted' to 'pending' for quick counts
  if (status === 'submitted') status = 'pending';

  const filters: { status?: string; counted_by?: number; company_ids?: number[] } = { status };
  if (!hasRole(user, 'manager')) filters.counted_by = user.id;
  // Company scope for everyone except an unrestricted admin (empty scope = no rows;
  // null-company legacy rows stay quarantined).
  const scope = companyScope(user);
  if (scope) filters.company_ids = scope;

  const counts = listQuickCounts(filters);
  const photoMap = getCountPhotosMap('quick_counts', counts.map((c: any) => c.id));
  const hydrated = counts.map((c: any) => ({ ...c, photos: photoMap[c.id] || [] }));
  return NextResponse.json({ counts: hydrated });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  initInventoryTables();
  const body = await request.json();
  const { entries, location_id } = body;

  if (!entries || !Array.isArray(entries) || !location_id) {
    return NextResponse.json({ error: 'entries array and location_id required' }, { status: 400 });
  }

  // The counting location's restaurant (from Odoo, never the client) drives review
  // scoping. Require an internal location tied to exactly one company; a shared or
  // unknown location can't be attributed to a restaurant.
  const locRows = await getOdoo().searchRead('stock.location', [['id', '=', Number(location_id)]], ['usage', 'company_id'], { limit: 1 });
  const loc = locRows[0] as { usage?: string; company_id?: [number, string] | false } | undefined;
  const locCompany = loc && Array.isArray(loc.company_id) ? loc.company_id[0] : false;
  if (!loc || loc.usage !== 'internal' || !locCompany) {
    return NextResponse.json({ error: 'Pick a stock location that belongs to a restaurant.' }, { status: 400 });
  }
  if (!canAccessCompany(user, locCompany)) {
    return NextResponse.json({ error: 'That location belongs to another restaurant.' }, { status: 403 });
  }

  // Load flags for the set of products in this submission
  const productIds: number[] = entries.map((e: any) => Number(e.product_id)).filter(Boolean);
  const flagRows = getProductFlags(productIds);
  const flagMap: Record<number, boolean> = {};
  flagRows.forEach(f => { flagMap[f.odoo_product_id] = !!f.requires_photo; });

  // Server-side validation: flagged + qty>0 must have at least one photo
  for (const entry of entries) {
    const pid = Number(entry.product_id);
    const qty = Number(entry.counted_qty);
    const photos: string[] = Array.isArray(entry.photos) ? entry.photos : [];
    if (flagMap[pid] && qty > 0 && photos.length === 0) {
      return NextResponse.json({
        error: `Product ${pid} requires a photo when counting`,
      }, { status: 400 });
    }
  }

  const ids: number[] = [];
  for (const entry of entries) {
    // If a crate split was sent, the base total is computed server-side.
    const upc = entry.units_per_crate != null && Number(entry.units_per_crate) > 0 ? Number(entry.units_per_crate) : null;
    const hasSplit = upc !== null && (entry.crate_qty !== undefined || entry.loose_qty !== undefined);
    const baseQty = hasSplit
      ? crateTotal(Number(entry.crate_qty) || 0, Number(entry.loose_qty) || 0, upc)
      : Number(entry.counted_qty);
    const id = createQuickCount({
      product_id: Number(entry.product_id),
      location_id,
      company_id: locCompany,
      counted_qty: baseQty,
      uom: entry.uom || 'Units',
      counted_by: resolveAttribution(user).userId,
      crate_qty: hasSplit ? (Number(entry.crate_qty) || 0) : null,
      loose_qty: hasSplit ? (Number(entry.loose_qty) || 0) : null,
      units_per_crate: hasSplit ? upc : null,
    });
    const photos: string[] = Array.isArray(entry.photos) ? entry.photos : [];
    if (photos.length > 0) {
      setCountPhotos('quick_counts', id, photos);
    }
    ids.push(id);
  }

  return NextResponse.json({ ids, message: `${ids.length} quick counts submitted` }, { status: 201 });
}
