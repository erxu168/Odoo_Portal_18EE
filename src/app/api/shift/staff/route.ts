/**
 * GET /api/shift/staff?company_id=X
 * Names for the "Working as" picker on a shared device: personal staff in the
 * active company who have a PIN set. Any signed-in device may read this.
 */
import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { listShiftStaff } from '@/lib/db';

export async function GET(request: Request) {
  try {
    requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = parseInt(searchParams.get('company_id') || '0', 10);
    if (!companyId) return NextResponse.json({ staff: [] });
    return NextResponse.json({ staff: listShiftStaff(companyId) });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
  }
}
