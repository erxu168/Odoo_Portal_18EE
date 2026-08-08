export const dynamic = 'force-dynamic';
/**
 * GET /api/closing-report/review?date=
 *
 * The manager's evening-in-review: one entry per participating department
 * (= has at least one active question), each with its report or an explicit
 * "missing" — a skipped night is visible, never silently blank.
 */
import { NextResponse } from 'next/server';
import { moduleForbidden } from '@/lib/module-access';
import { fetchDepartments } from '@/lib/shifts-odoo';
import { CAP, actorCan } from '@/lib/closing-report/access';
import { authorize, initClosingTables, jsonError, requestedNight, resolveCompany } from '@/lib/closing-report/route-helpers';
import { departmentIdsWithQuestions, listReportsForDate } from '@/lib/closing-report/db';
import { closingOperationalDate } from '@/lib/closing-report/night';

export async function GET(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.review);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const date = requestedNight(request);
  if (date > closingOperationalDate()) return jsonError(400, 'That night has not happened yet.');

  let odooDepts: { id: number; name: string }[];
  try {
    odooDepts = await fetchDepartments(companyId);
  } catch (e) {
    console.error('[closing-report] review department fetch failed:', e);
    return jsonError(502, 'Could not load departments right now. Please try again.');
  }
  const nameById = new Map(odooDepts.map((d) => [d.id, d.name]));

  const participating = departmentIdsWithQuestions(companyId);
  const reports = listReportsForDate(companyId, date);
  const reportByDept = new Map(reports.map((r) => [r.department_id, r]));

  // Departments with a report that day always show, even if their questions
  // were later deleted — history outranks the current template.
  const deptIds = Array.from(new Set([...participating, ...reports.map((r) => r.department_id)]));

  const entries = deptIds.map((id) => ({
    department_id: id,
    name: nameById.get(id) || `Department ${id}`,
    report: reportByDept.get(id) || null,
  })).sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    date,
    company_id: companyId,
    entries,
    can_manage: actorCan(authz.actor, CAP.manage),
  });
}
