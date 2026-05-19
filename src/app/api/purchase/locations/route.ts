/**
 * GET /api/purchase/locations
 * Returns portal purchase locations (SSAM, GBM38, What a Jerk, …).
 * Replaces the old hardcoded LOCATIONS array in page.tsx so new locations
 * (e.g. What a Jerk, added via auto-discover) appear in the picker without
 * code changes.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listLocations } from '@/lib/purchase-db';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const locations = listLocations().map((l) => ({
    id: l.id,
    name: l.name,
    key: l.name,
  }));

  return NextResponse.json({ locations });
}
