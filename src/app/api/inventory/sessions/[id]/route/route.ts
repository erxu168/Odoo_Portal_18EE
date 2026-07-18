export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/sessions/[id]/route
 * The guided walking route for a session: ordered stops (locations) with their
 * products in shelf order, each stop's counted/skipped status, and a final
 * "Everything else" stop for unplaced products. guided:false => flat counting.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initInventoryTables, getSession } from '@/lib/inventory-db';
import { resolveSessionRoute } from '@/lib/session-route';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  // Staff may only view a route for a session assigned to them.
  if (!hasRole(user, 'manager') && session.assigned_user_id !== user.id)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json(resolveSessionRoute(id));
}
