/**
 * GET /api/auth/session-flags
 * Tiny, session-only flags for the client shell (no Odoo lookups, so it can't be
 * slowed by an Odoo outage). Used by StationGate to re-check "is this a shared
 * tablet?" on navigation without pulling the heavier /api/auth/me (which waits
 * on an Odoo avatar fetch).
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export function GET() {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return NextResponse.json({ is_shared_device: !!user.is_shared_device });
}
