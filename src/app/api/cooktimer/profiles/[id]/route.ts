export const dynamic = 'force-dynamic';
/**
 * PATCH  /api/cooktimer/profiles/[id]
 *   - full edit: body CookProfileInput (has `steps`) → updateProfile
 *   - quick toggle: body { active: boolean } (no `steps`) → setProfileActive
 *   → { profiles }
 * DELETE /api/cooktimer/profiles/[id] → { profiles }
 *
 * Manager-only (cooktimer.config.manage). Structural edits are blocked while a
 * timer is running for the product; the active toggle is always allowed.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { listProfilesAdmin, listStationsAdmin, updateProfile, setProfileActive, deleteProfile, CookSetupError } from '@/lib/cooktimer-db';
import type { CookProfileInput } from '@/types/cooktimer';

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
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  const b = body as Record<string, unknown>;
  try {
    if (Array.isArray(b.steps)) {
      updateProfile(id, b as unknown as CookProfileInput); // full edit (DB layer validates)
    } else if (typeof b.active === 'boolean') {
      setProfileActive(id, b.active);                     // quick on/off toggle
    } else {
      return NextResponse.json({ error: 'Provide a full profile (with steps) or an active flag' }, { status: 400 });
    }
    return NextResponse.json({ profiles: listProfilesAdmin(), stations: listStationsAdmin() });
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
    deleteProfile(id);
    return NextResponse.json({ profiles: listProfilesAdmin(), stations: listStationsAdmin() });
  } catch (err) {
    return fail(err);
  }
}
