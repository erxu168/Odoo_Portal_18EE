/**
 * GET /api/shifts/presence?company_id=6
 * Manager-only. Live "Right Now" board: today's scheduled staff with their
 * clock-in state (present / late / due / upcoming / done), derived from Odoo
 * hr.attendance. Late grace defaults to 10 min until wired to shift settings.
 */
import { NextResponse } from 'next/server';
import { requireManagerCompany, serverError } from '../_manager';
import { computePresence } from '@/lib/shifts-presence';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = requireManagerCompany(searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  try {
    const grace = 10; // TODO: read lateAlert grace from shift settings once added
    const result = await computePresence(auth.companyId, grace);
    return NextResponse.json(result);
  } catch (err: unknown) {
    return serverError('presence', err);
  }
}
