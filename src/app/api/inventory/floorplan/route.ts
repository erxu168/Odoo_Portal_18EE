export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplan — the staff viewer manifest (view).
 * One payload: floors + anchors + places + product search index + types.
 * ?spot=<locationId> additionally resolves where that spot lives (deep links,
 * QR stickers, "Show on map") — the company always comes from the SPOT's own
 * row, never from the query string.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authorizeFloorplan, FLOORPLAN_CAP, canAccessCompany, writeCompany } from '@/lib/inventory-floorplan/access';
import { buildManifest, placedProductIds, type InjectedProduct } from '@/lib/inventory-floorplan/manifest';
import { findAnchorForLocationOrAncestor, initFloorplanTables } from '@/lib/inventory-floorplan/db';
import { getCountLocation } from '@/lib/inventory-db';
import { getOdoo } from '@/lib/odoo';
import { moduleForbidden } from '@/lib/module-access';

async function fetchProducts(ids: number[]): Promise<InjectedProduct[] | null> {
  if (ids.length === 0) return [];
  try {
    const odoo = getOdoo();
    const rows = (await odoo.searchRead(
      'product.product',
      [['id', 'in', ids]],
      ['display_name', 'categ_id'],
    )) as Array<{ id: number; display_name: string; categ_id: [number, string] | false }>;
    return rows.map(r => ({
      id: r.id,
      name: r.display_name,
      category: Array.isArray(r.categ_id) ? r.categ_id[1] : null,
    }));
  } catch {
    return null; // Odoo down → spot search still works, product search says so
  }
}

export async function GET(request: Request) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;

  const authz = authorizeFloorplan(FLOORPLAN_CAP.view);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const { searchParams } = new URL(request.url);

  // Deep link / focus resolution: the spot's row decides company AND floor.
  let focus: { locationId: number; floorId: number; cx: number; cy: number } | null = null;
  let focusMissing = false;
  let focusAsked: { id: number; name: string } | null = null;
  let focusVia: { id: number; name: string } | null = null;
  const spotRaw = searchParams.get('spot');
  let companyId: number | null = null;

  if (spotRaw != null) {
    if (!/^\d+$/.test(spotRaw)) return NextResponse.json({ error: 'Invalid spot' }, { status: 400 });
    const loc = getCountLocation(parseInt(spotRaw, 10));
    if (!loc || !canAccessCompany(authz.user, loc.company_id)) {
      return NextResponse.json({ error: 'Spot not found' }, { status: 404 });
    }
    companyId = loc.company_id;
    // Itself if pinned, else the nearest ancestor that is — a drawer never has
    // its own pin, so "no pin on this exact spot" is the ordinary case.
    const anchor = findAnchorForLocationOrAncestor(loc.id);
    if (anchor) {
      focus = { locationId: anchor.via ? anchor.via.id : loc.id, floorId: anchor.floor_id, cx: anchor.cx, cy: anchor.cy };
      // What was ASKED for, and what was actually found, so the screen can say
      // "D4 is inside the Countertop fridge — shown here" rather than quietly
      // highlighting something the person did not ask about.
      focusAsked = { id: loc.id, name: loc.name };
      focusVia = anchor.via;
    } else {
      focusMissing = true;   // nothing in the whole chain is on a published plan
      focusAsked = { id: loc.id, name: loc.name };
    }
  }

  if (companyId == null) {
    const requested = parseInt(searchParams.get('company_id') || '0', 10) || null;
    if (requested && !canAccessCompany(authz.user, requested)) {
      return NextResponse.json({ error: 'That restaurant is not available to you' }, { status: 403 });
    }
    const cookieCompany = parseInt(cookies().get('kw_company_id')?.value || '0', 10) || null;
    const fallback = cookieCompany && canAccessCompany(authz.user, cookieCompany) ? cookieCompany : null;
    companyId = writeCompany(authz.user, requested ?? fallback);
  }
  if (!companyId) {
    return NextResponse.json({ manifest: null, focus: null, focusMissing: false, focusAsked: null, focusVia: null });
  }

  const products = await fetchProducts(placedProductIds(companyId));
  const manifest = buildManifest(companyId, { products });
  return NextResponse.json({ manifest, focus, focusMissing, focusAsked, focusVia });
}
