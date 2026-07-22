export const dynamic = 'force-dynamic';
/**
 * Manager-only Cooking Timer profile setup.
 *
 * GET  /api/cooktimer/profiles   → { profiles: CookProfile[] } (incl. inactive, with steps)
 * POST /api/cooktimer/profiles   body CookProfileInput → create, 201 { profiles }
 *
 * Gated on `cooktimer.config.manage`. A profile maps one Odoo product
 * (product.product id) to a station + an ordered step chain.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { listProfilesAdmin, listStationsAdmin, createProfile, CookSetupError } from '@/lib/cooktimer-db';
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

export async function GET() {
  const g = gate();
  if (g.error) return g.error;
  try {
    return NextResponse.json({ profiles: listProfilesAdmin() });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  const g = gate();
  if (g.error) return g.error;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  try {
    // The DB layer's validateProfileInput coerces + validates every field.
    createProfile(body as CookProfileInput);
    // Return stations too: their profileCount changed, which gates station delete.
    return NextResponse.json({ profiles: listProfilesAdmin(), stations: listStationsAdmin() }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
