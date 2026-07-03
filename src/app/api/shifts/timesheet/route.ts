/**
 * GET /api/shifts/timesheet?company_id=6&week=2026-W28
 * Manager-only. §17 MiLoG weekly working-time records per employee (from
 * hr.attendance): daily start / end / duration for review and CSV export.
 */
import { NextResponse } from 'next/server';
import { requireManagerCompany, resolveWeekKey, serverError } from '../_manager';
import { fetchWeekTimesheet } from '@/lib/shifts-timesheet';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = requireManagerCompany(searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  const weekKey = resolveWeekKey(searchParams.get('week'));
  if (!weekKey) return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
  try {
    const result = await fetchWeekTimesheet(auth.companyId, weekKey);
    return NextResponse.json(result);
  } catch (err: unknown) {
    return serverError('timesheet', err);
  }
}
