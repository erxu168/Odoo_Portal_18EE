/**
 * GET /api/shifts/compliance?company_id=6&from=2026-W28&to=2026-W31
 * Manager-only. Per-employee attendance compliance over a range of ISO weeks:
 * late / early / overtime (with decisions) / missed breaks / acknowledgements,
 * plus a repeat-offender highlight. Derived on demand; nothing stored.
 */
import { NextResponse } from 'next/server';
import { requireManagerCompany, resolveWeekKey, serverError } from '../_manager';
import { fetchComplianceReport, weeksInRange } from '@/lib/shifts-compliance';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = requireManagerCompany(searchParams.get('company_id'));
  if (!auth.ok) return auth.res;

  const toWeek = resolveWeekKey(searchParams.get('to'));
  const fromWeek = resolveWeekKey(searchParams.get('from'));
  if (!fromWeek || !toWeek) return NextResponse.json({ error: 'Invalid week range' }, { status: 400 });
  if (weeksInRange(fromWeek, toWeek).length === 0) {
    return NextResponse.json({ error: 'The "from" week must not be after the "to" week.' }, { status: 400 });
  }

  try {
    const report = await fetchComplianceReport(auth.companyId, fromWeek, toWeek);
    return NextResponse.json(report);
  } catch (err: unknown) {
    return serverError('compliance', err);
  }
}
