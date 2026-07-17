/**
 * GET /api/tablet/staff — names for the tablet LOGIN name picker (name-then-PIN).
 *
 * Auth is the DEVICE token (kw_tablet), NOT a session: this runs on /login BEFORE
 * anyone is signed in, so /api/shift/staff (which needs a session) can't be used.
 * The restaurant comes ONLY from the trusted device record, never the client.
 * Lives under the public /api/tablet prefix; no-store so a shared device never
 * caches the roster. Returns staff in this restaurant who have a PIN set.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getStationDevice, listStationCandidates } from '@/lib/db';
import { employeesWithPin } from '@/lib/shifts-db';

export const dynamic = 'force-dynamic';

export function GET() {
  const token = cookies().get('kw_tablet')?.value;
  const device = token ? getStationDevice(token) : null;
  // Fail closed: an unprovisioned/revoked/disabled device gets an empty list, not
  // an error that would reveal whether a token is valid.
  if (!device || device.disabled) {
    return NextResponse.json({ staff: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const pinned = employeesWithPin(device.company_id);
  const seen = new Set<number>();
  const staff = listStationCandidates(device.company_id)
    .filter(c => {
      // Only people with a PIN set; collapse duplicate accounts on one employee.
      if (!pinned.has(c.employee_id) || seen.has(c.employee_id)) return false;
      seen.add(c.employee_id);
      return true;
    })
    .map(c => ({ id: c.id, name: c.name }));
  return NextResponse.json({ staff }, { headers: { 'Cache-Control': 'no-store' } });
}
