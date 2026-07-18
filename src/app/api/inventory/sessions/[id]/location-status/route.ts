export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/sessions/[id]/location-status
 * Mark a stop on the guided route counted, or skipped with a reason.
 * Body: { count_location_id: number, status: 'pending'|'counted'|'skipped', skip_reason?: string }
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initInventoryTables, getSession, setSessionLocationStatus } from '@/lib/inventory-db';
import { canAccessSession } from '@/lib/inventory-access';
import { resolveSessionRoute } from '@/lib/session-route';

const STATUSES = ['pending', 'counted', 'skipped'];

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  // The assigned staff, any staff of the restaurant for an unassigned list, or
  // a manager may update a session's stops.
  if (!canAccessSession(user, session))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Locked once submitted/reviewed.
  if (session.status !== 'pending' && session.status !== 'in_progress')
    return NextResponse.json({ error: 'This count can no longer be edited' }, { status: 400 });

  const body = await request.json();
  const countLocationId = Number(body.count_location_id);
  const status = String(body.status || '');
  if (!Number.isInteger(countLocationId) || countLocationId < 0)
    return NextResponse.json({ error: 'count_location_id required' }, { status: 400 });
  if (!STATUSES.includes(status))
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  const skipReason = status === 'skipped' ? (String(body.skip_reason || '').trim() || null) : null;
  if (status === 'skipped' && !skipReason)
    return NextResponse.json({ error: 'A reason is required to skip a location' }, { status: 400 });

  // The bucket must be a real stop on this session's route (prevents arbitrary /
  // cross-company statuses corrupting guided-state detection).
  const validBuckets = new Set(resolveSessionRoute(id).stops.map((s) => s.bucket_id));
  if (!validBuckets.has(countLocationId))
    return NextResponse.json({ error: 'That location is not part of this count' }, { status: 400 });

  setSessionLocationStatus(id, countLocationId, status, skipReason);
  return NextResponse.json({ message: 'Saved' });
}
