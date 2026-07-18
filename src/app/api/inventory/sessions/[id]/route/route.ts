export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/sessions/[id]/route
 * The guided walking route for a session: ordered stops (locations) with their
 * products in shelf order, each stop's counted/skipped status, and a final
 * "Everything else" stop for unplaced products. guided:false => flat counting.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initInventoryTables, getSession } from '@/lib/inventory-db';
import { canAccessSession } from '@/lib/inventory-access';
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
  // Staff may view a route for their own assigned session, or an unassigned
  // ("Anyone"/department) session in their restaurant. Managers: any.
  if (!canAccessSession(user, session))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json(resolveSessionRoute(id));
}
