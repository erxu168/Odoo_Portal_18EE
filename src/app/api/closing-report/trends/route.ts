export const dynamic = 'force-dynamic';
/**
 * GET /api/closing-report/trends?department_id=&days=
 * Submission rate, nightly average rating, and recurring problem counts.
 */
import { NextResponse } from 'next/server';
import { moduleForbidden } from '@/lib/module-access';
import { CAP } from '@/lib/closing-report/access';
import { authorize, initClosingTables, jsonError, requestedDepartment, resolveCompany } from '@/lib/closing-report/route-helpers';
import { trendsData } from '@/lib/closing-report/db';
import { closingOperationalDate, shiftDay } from '@/lib/closing-report/night';

export async function GET(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.review);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const departmentId = requestedDepartment(request);
  if (!departmentId) return jsonError(400, 'Which department?');

  const daysRaw = parseInt(new URL(request.url).searchParams.get('days') || '30', 10);
  const days = Math.min(90, Math.max(7, Number.isFinite(daysRaw) ? daysRaw : 30));
  const lastNight = closingOperationalDate();
  const since = shiftDay(lastNight, -(days - 1));

  return NextResponse.json({
    days,
    since,
    until: lastNight,
    ...trendsData(companyId, departmentId, since),
  });
}
