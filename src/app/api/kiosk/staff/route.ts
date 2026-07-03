/**
 * GET /api/kiosk/staff?company_id=6  (PUBLIC — device kiosk, no login)
 * Lists the company's staff who have a kiosk PIN, with their clocked-in state.
 */
import { NextResponse } from 'next/server';
import { employeesWithPin } from '@/lib/shifts-db';
import { kioskStaffList } from '@/lib/shifts-kiosk';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = parseInt(searchParams.get('company_id') || '', 10);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  }
  try {
    const pinned = employeesWithPin(companyId);
    const staff = await kioskStaffList(companyId, pinned);
    return NextResponse.json({ staff });
  } catch (err: unknown) {
    console.error('[kiosk] staff error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not load staff' }, { status: 500 });
  }
}
