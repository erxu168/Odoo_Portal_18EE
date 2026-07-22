export const dynamic = 'force-dynamic';
/**
 * Manager-only Cooking Timer station setup.
 *
 * GET   /api/cooktimer/stations           → { stations: CookStationAdmin[] }
 * POST  /api/cooktimer/stations           body { name }          → create, 201 { stations }
 * PATCH /api/cooktimer/stations           body { order: number[] } → reorder → { stations }
 *
 * All gated on `cooktimer.config.manage`. Every mutation returns the fresh full
 * list so the client replaces its local state (canonical response).
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import {
  listStationsAdmin, createStation, reorderStations, CookSetupError,
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

export async function GET() {
  const g = gate();
  if (g.error) return g.error;
  try {
    return NextResponse.json({ stations: listStationsAdmin() });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  const g = gate();
  if (g.error) return g.error;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  try {
    createStation(typeof b.name === 'string' ? b.name : '');
    return NextResponse.json({ stations: listStationsAdmin() }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(request: Request) {
  const g = gate();
  if (g.error) return g.error;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  if (!Array.isArray(b.order)) return NextResponse.json({ error: 'order must be an array of station ids' }, { status: 400 });
  const order = b.order.map(n => Number(n));
  if (order.some(n => !Number.isInteger(n))) return NextResponse.json({ error: 'order must be integers' }, { status: 400 });
  try {
    return NextResponse.json({ stations: reorderStations(order) });
  } catch (err) {
    return fail(err);
  }
}
