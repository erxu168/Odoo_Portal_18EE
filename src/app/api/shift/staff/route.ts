/**
 * GET /api/shift/staff?company_id=X
 * Names for the "Working as" picker on a shared device: personal staff in the
 * active company who have a PIN set. Any signed-in device may read this.
 */
import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { parseCompanyIds, listStationCandidates } from '@/lib/db';
import { employeesWithPin } from '@/lib/shifts-db';

export async function GET(request: Request) {
  try {
    // Station-only: this name picker is for shared kitchen tablets, not personal accounts.
    const device = requireAuth();
    if (!device.is_shared_device) {
      return NextResponse.json({ error: 'This screen only works on a station tablet.' }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const companyId = parseInt(searchParams.get('company_id') || '0', 10);
    if (!companyId) return NextResponse.json({ staff: [] });
    if (!parseCompanyIds(device.allowed_company_ids).includes(companyId)) {
      return NextResponse.json({ error: 'This tablet is not set up for that restaurant.' }, { status: 403 });
    }
    // Only show people who actually have a PIN set (in the canonical kiosk store), and
    // collapse duplicate accounts on the same employee — they share one canonical PIN, so
    // showing both would offer two rows (different user ids) for the same person.
    const pinned = employeesWithPin(companyId);
    const seen = new Set<number>();
    const staff = listStationCandidates(companyId)
      .filter(c => {
        if (!pinned.has(c.employee_id) || seen.has(c.employee_id)) return false;
        seen.add(c.employee_id);
        return true;
      })
      .map(c => ({ id: c.id, name: c.name }));
    return NextResponse.json({ staff });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
  }
}
