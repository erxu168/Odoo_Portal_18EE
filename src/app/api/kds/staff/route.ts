/**
 * GET /api/kds/staff?configId=X  (PUBLIC — no-login KDS device)
 * Lists the register company's staff who have a kiosk PIN, so a cook can pick
 * themselves and complete a task with their existing 4-digit clock-in PIN.
 * Mirrors /api/kiosk/staff, but resolves the company from the POS configId.
 */
import { NextRequest, NextResponse } from 'next/server';
import { employeesWithPin } from '@/lib/shifts-db';
import { kioskStaffList } from '@/lib/shifts-kiosk';
import { companyIdForConfig } from '@/lib/kds/company';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const configId = Number(req.nextUrl.searchParams.get('configId')) || 0;
    const companyId = await companyIdForConfig(configId);
    if (!companyId) return NextResponse.json({ staff: [] });

    const pinned = employeesWithPin(companyId);
    const staff = await kioskStaffList(companyId, pinned);
    return NextResponse.json({ staff });
  } catch (err: unknown) {
    console.error('[KDS] staff error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not load staff' }, { status: 500 });
  }
}
