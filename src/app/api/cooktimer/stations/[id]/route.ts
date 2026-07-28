export const dynamic = 'force-dynamic';
/**
 * PATCH  /api/cooktimer/stations/[id]   body { name?, active? }  → { stations }
 * DELETE /api/cooktimer/stations/[id]                            → { stations }
 *
 * Manager-only (cooktimer.config.manage). Rename and/or toggle active; delete is
 * blocked while the station has profiles or a running timer. Returns the fresh list.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import {
  listStationsAdmin, updateStation, deleteStation, CookSetupError,
} from '@/lib/cooktimer-db';
import { listProfilesWithNames } from '@/lib/cooktimer-products';

const CAP = 'cooktimer.config.manage';

function gate() {
  const user = getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!roleCan(user.role, CAP, getPermissionOverrides())) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user };
}

function fail(err: unknown) {
  if (err instanceof CookSetupError) return NextResponse.json({ error: err.message }, { status: err.status });
  const msg = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function PATCH(request: Request, ctx: { params: { id: string } }) {
  const g = gate();
  if (g.error) return g.error;
  const id = parseInt(ctx.params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id must be an integer' }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  if (typeof b.name !== 'string' && typeof b.active !== 'boolean') {
    return NextResponse.json({ error: 'Provide a name and/or active flag' }, { status: 400 });
  }
  try {
    // Atomic: rename + toggle apply together (or not at all) — no partial update.
    updateStation(id, {
      name: typeof b.name === 'string' ? b.name : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
    });
    return NextResponse.json({ stations: listStationsAdmin() });
  } catch (err) {
    return fail(err);
  }
}

/**
 * DELETE /api/cooktimer/stations/[id]   optional body { moveToStationId }
 * Deleting a station that still holds cook profiles requires saying where those
 * profiles go; they are reassigned in the same transaction. Profiles change
 * station, so the fresh profile list is returned too.
 */
export async function DELETE(request: Request, ctx: { params: { id: string } }) {
  const g = gate();
  if (g.error) return g.error;
  const id = parseInt(ctx.params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id must be an integer' }, { status: 400 });

  // An EMPTY body means "plain delete"; MALFORMED JSON is a client error and
  // must not silently fall through to deleting the station.
  let moveToStationId: number | null = null;
  const raw = (await request.text()).trim();
  if (raw !== '') {
    let body: unknown;
    try { body = JSON.parse(raw); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
    }
    const v = (body as { moveToStationId?: unknown }).moveToStationId;
    if (v != null) {
      // Require a real JSON number — Number(true) would otherwise become id 1.
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
        return NextResponse.json({ error: 'moveToStationId must be a station id' }, { status: 400 });
      }
      moveToStationId = v;
    }
  }

  try {
    deleteStation(id, moveToStationId);
    return NextResponse.json({ stations: listStationsAdmin(), ...(await listProfilesWithNames()) });
  } catch (err) {
    return fail(err);
  }
}
