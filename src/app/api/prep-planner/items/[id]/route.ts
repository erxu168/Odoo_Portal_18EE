export const dynamic = 'force-dynamic';
/**
 * GET    /api/prep-planner/items/[id]
 *   → item detail + its POS links
 *
 * PATCH  /api/prep-planner/items/[id]
 *   body: partial PrepItemInput (+ optional "active": 0|1)
 *   → update fields
 *
 * DELETE /api/prep-planner/items/[id]
 *   → hard delete (cascades to prep_pos_link and prep_item_forecasts)
 */
import { NextResponse } from 'next/server';
import {
  getPrepItem,
  updatePrepItem,
  deletePrepItem,
  listLinksForPrepItem,
} from '@/lib/prep-planner-mapping-db';

export async function GET(
  _request: Request,
  ctx: { params: { id: string } },
) {
  const id = parseInt(ctx.params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'id must be an integer' }, { status: 400 });
  }
  try {
    const item = getPrepItem(id);
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const links = listLinksForPrepItem(id);
    return NextResponse.json({ item, links });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: { id: string } },
) {
  const id = parseInt(ctx.params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'id must be an integer' }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  try {
    const existing = getPrepItem(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const validPrepTypes = ['advance', 'batch', 'ondemand'] as const;
    const prepType =
      b.prep_type === null
        ? null
        : typeof b.prep_type === 'string' &&
          (validPrepTypes as readonly string[]).includes(b.prep_type)
        ? (b.prep_type as 'advance' | 'batch' | 'ondemand')
        : undefined;

    updatePrepItem(id, {
      name: typeof b.name === 'string' ? b.name.trim() : undefined,
      location_id:
        b.location_id === null
          ? null
          : typeof b.location_id === 'number'
          ? b.location_id
          : undefined,
      station: b.station === null ? null : typeof b.station === 'string' ? b.station : undefined,
      prep_type: prepType,
      prep_time_min:
        b.prep_time_min === null
          ? null
          : typeof b.prep_time_min === 'number'
          ? b.prep_time_min
          : undefined,
      max_holding_min:
        b.max_holding_min === null
          ? null
          : typeof b.max_holding_min === 'number'
          ? b.max_holding_min
          : undefined,
      batch_size:
        b.batch_size === null
          ? null
          : typeof b.batch_size === 'number'
          ? b.batch_size
          : undefined,
      unit: typeof b.unit === 'string' ? b.unit : undefined,
      notes: b.notes === null ? null : typeof b.notes === 'string' ? b.notes : undefined,
      active: typeof b.active === 'number' ? (b.active ? 1 : 0) : undefined,
    });
    const updated = getPrepItem(id);
    return NextResponse.json({ item: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = /UNIQUE constraint failed/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: { id: string } },
) {
  const id = parseInt(ctx.params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'id must be an integer' }, { status: 400 });
  }
  try {
    deletePrepItem(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
