export const dynamic = 'force-dynamic';
/**
 * /api/inventory/templates/[id]/placements — "Arrange spots" for a list.
 *
 * Placements are the products' GLOBAL HOME SPOTS (product_locations) scoped to
 * this list's products — the one record every screen edits. Arranging spots
 * here therefore updates those products everywhere, not just on this list.
 *
 * GET — the list's products' home spots + the restaurant's spots, plus whether
 *       today's session could still take a new layout (untouched).
 * PUT — replace those products' home spots: [{odoo_product_id,
 *       count_location_id, shelf_sort}]. Spot 0 rows are implied (unplaced
 *       products always count at General) and are not stored. With
 *       apply_today: true, an untouched pending session for today is
 *       regenerated so the new walk applies immediately.
 *
 * Manager-only (inventory.template.manage). Spots must belong to the list's
 * restaurant; products must be on the list.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, parseCompanyIds } from '@/lib/db';
import {
  initInventoryTables, getTemplate, getPlacementsForProducts, setProductsSpotsBulk,
  listCountLocations, regenerateTodaySession, getSession, todayStr,
  untouchedTodaySessionId,
} from '@/lib/inventory-db';

function authTemplate(user: { role: string; allowed_company_ids: string | null }, id: number) {
  const tmpl = getTemplate(id);
  if (!tmpl) return { error: NextResponse.json({ error: 'List not found' }, { status: 404 }) };
  const allowed = parseCompanyIds(user.allowed_company_ids);
  const adminUnrestricted = user.role === 'admin' && allowed.length === 0;
  if (tmpl.company_id != null && !adminUnrestricted && !allowed.includes(tmpl.company_id)) {
    return { error: NextResponse.json({ error: 'That list belongs to another restaurant' }, { status: 403 }) };
  }
  if (tmpl.company_id == null) {
    return { error: NextResponse.json({ error: 'Save this list once to tag its restaurant first.' }, { status: 400 }) };
  }
  return { tmpl };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.template.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  initInventoryTables();
  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const { tmpl, error } = authTemplate(user, id);
  if (error) return error;

  // Home spots of THIS list's products, restricted to this restaurant's spots.
  const spots = listCountLocations(tmpl!.company_id as number);
  const validSpots = new Set(spots.map((l) => l.id));
  const placements = getPlacementsForProducts(tmpl!.product_ids as number[])
    .filter((pl) => validSpots.has(pl.count_location_id));
  return NextResponse.json({
    template_id: id,
    product_ids: tmpl!.product_ids,
    placements,
    spots,
    today_session_untouched: untouchedTodaySessionId(id) != null,
  });
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.template.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  initInventoryTables();
  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const { tmpl, error } = authTemplate(user, id);
  if (error) return error;

  const body = await request.json();
  if (!Array.isArray(body.placements)) {
    return NextResponse.json({ error: 'placements array required' }, { status: 400 });
  }
  // STRICT: every submitted row must name a product on the list and a real spot
  // of THIS restaurant. A stale row (spot deleted after the editor loaded, or a
  // product no longer on the list) rejects the WHOLE request — silently
  // dropping it would then CLEAR that product's home spots on save.
  const validSpots = new Set(listCountLocations(tmpl!.company_id as number).map((l) => l.id));
  const listIds = new Set<number>((tmpl!.product_ids as number[]).map(Number));
  const rows: { odoo_product_id: number; count_location_id: number }[] = [];
  for (const r of body.placements as any[]) {
    const pid = Number(r?.odoo_product_id);
    const sid = Number(r?.count_location_id);
    if (!Number.isInteger(pid) || !listIds.has(pid))
      return NextResponse.json({ error: 'A product in this layout is no longer on the list — reload and try again' }, { status: 409 });
    if (!Number.isInteger(sid) || sid <= 0 || !validSpots.has(sid))
      return NextResponse.json({ error: 'A spot in this layout was removed — reload and try again' }, { status: 409 });
    rows.push({ odoo_product_id: pid, count_location_id: sid });
  }

  // PATCH scope: only the products the editor actually TOUCHED are replaced
  // (body.products). Untouched products keep whatever another door (SpotSheet /
  // Locations screen) saved meanwhile — no lost updates from a stale full
  // layout. A legacy payload without `products` replaces every listed product.
  let scope: number[];
  if ('products' in body && !Array.isArray(body.products)) {
    // A PRESENT but malformed scope must never widen to "replace everything".
    return NextResponse.json({ error: 'products must be an array of product ids' }, { status: 400 });
  }
  if (Array.isArray(body.products)) {
    const touched = body.products.map(Number);
    if (touched.some((pid: number) => !Number.isInteger(pid) || !listIds.has(pid)))
      return NextResponse.json({ error: 'A touched product is no longer on the list — reload and try again' }, { status: 409 });
    scope = Array.from(new Set<number>(touched));
  } else {
    scope = Array.from(listIds);
  }
  const scopeSet = new Set(scope);
  if (rows.some((r) => !scopeSet.has(r.odoo_product_id) && Array.isArray(body.products)))
    return NextResponse.json({ error: 'Layout rows outside the touched products — reload and try again' }, { status: 400 });

  // ONE transaction: every scoped product gets exactly its submitted spots
  // (none submitted = cleared, within this restaurant only). All-or-nothing.
  const bySpotOrder = new Map<number, number[]>();
  for (const r of rows) {
    const arr = bySpotOrder.get(r.odoo_product_id) || [];
    if (!arr.includes(r.count_location_id)) arr.push(r.count_location_id);
    bySpotOrder.set(r.odoo_product_id, arr);
  }
  try {
    setProductsSpotsBulk(tmpl!.company_id as number,
      scope.map((pid) => ({ product_id: pid, spot_ids: bySpotOrder.get(pid) || [] })));
  } catch {
    return NextResponse.json({ error: 'A spot was just removed — reload and try again' }, { status: 409 });
  }

  // "Apply to today": only when today's count is genuinely untouched — anything
  // staff started is never destroyed. The fresh session snapshots this layout.
  let appliedToday = false;
  if (body.apply_today === true && untouchedTodaySessionId(id) != null) {
    const sid = regenerateTodaySession(id);
    appliedToday = sid != null && getSession(sid)?.scheduled_date === todayStr();
  }

  return NextResponse.json({
    message: 'Spot layout saved',
    placement_count: rows.length,
    applied_today: appliedToday,
    today_session_untouched: untouchedTodaySessionId(id) != null,
  });
}
