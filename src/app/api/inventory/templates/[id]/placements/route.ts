export const dynamic = 'force-dynamic';
/**
 * /api/inventory/templates/[id]/placements — a list's "Arrange spots" layout.
 *
 * GET — the list's placements + the restaurant's spots (for the editor), plus
 *       whether today's session could still take a new layout (untouched).
 * PUT — replace the layout: [{odoo_product_id, count_location_id, shelf_sort}].
 *       Spot 0 rows are implied (unplaced products always count at General) and
 *       are not stored. With apply_today: true, an untouched pending session for
 *       today is regenerated so the new walk applies immediately.
 *
 * Manager-only (inventory.template.manage). Spots must belong to the list's
 * restaurant; products must be on the list.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, parseCompanyIds } from '@/lib/db';
import {
  initInventoryTables, getTemplate, getTemplatePlacements, setTemplatePlacements,
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

  return NextResponse.json({
    template_id: id,
    product_ids: tmpl!.product_ids,
    placements: getTemplatePlacements(id),
    spots: listCountLocations(tmpl!.company_id as number),
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
  // Only well-formed rows: a REAL spot of THIS restaurant + a product on the
  // list. Spot 0 is implied for unplaced products, never stored.
  const validSpots = new Set(listCountLocations(tmpl!.company_id as number).map((l) => l.id));
  const listIds = new Set<number>((tmpl!.product_ids as number[]).map(Number));
  const rows = (body.placements as any[])
    .map((r) => ({
      odoo_product_id: Number(r?.odoo_product_id),
      count_location_id: Number(r?.count_location_id),
      shelf_sort: Number.isFinite(Number(r?.shelf_sort)) ? Number(r.shelf_sort) : 0,
    }))
    .filter((r) => Number.isInteger(r.odoo_product_id) && listIds.has(r.odoo_product_id)
      && Number.isInteger(r.count_location_id) && r.count_location_id > 0 && validSpots.has(r.count_location_id));

  setTemplatePlacements(id, rows);

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
