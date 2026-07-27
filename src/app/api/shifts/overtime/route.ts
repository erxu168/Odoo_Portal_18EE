/**
 * GET /api/shifts/overtime?company_id=6&week=2026-W28
 * Manager-only. Overtime events for the week (each clock-out past the grace),
 * joined to the manager's approve/reject decision. Events are derived from
 * hr.attendance × schedule; only decisions are stored.
 */
import { NextResponse } from 'next/server';
import { requireManagerCompany, resolveWeekKey, serverError } from '../_manager';
import { fetchOvertimeWeek } from '@/lib/shifts-overtime';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = requireManagerCompany(searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  const weekKey = resolveWeekKey(searchParams.get('week'));
  if (!weekKey) return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
  try {
    const result = await fetchOvertimeWeek(auth.companyId, weekKey);
    return NextResponse.json(result);
  } catch (err: unknown) {
    return serverError('overtime', err);
  }
}
