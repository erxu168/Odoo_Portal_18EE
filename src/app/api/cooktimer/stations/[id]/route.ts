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

export async function DELETE(_request: Request, ctx: { params: { id: string } }) {
  const g = gate();
  if (g.error) return g.error;
  const id = parseInt(ctx.params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id must be an integer' }, { status: 400 });
  try {
    deleteStation(id);
    return NextResponse.json({ stations: listStationsAdmin() });
  } catch (err) {
    return fail(err);
  }
}
