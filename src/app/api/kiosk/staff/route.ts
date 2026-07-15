/**
 * GET /api/kiosk/staff?company_id=6  (PUBLIC — device kiosk, no login)
 * Lists ALL of the company's active staff with their clocked-in state and a
 * `hasPin` flag. Staff without a PIN still appear so they can set one up at the
 * tablet (see /api/kiosk/setup/*).
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
