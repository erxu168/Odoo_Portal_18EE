export const dynamic = 'force-dynamic';
/**
 * GET /api/closing-report/departments
 *
 * The module's entry data: which departments take part tonight (= have at least
 * one active question), each with its report status for the current night, plus
 * UI capability flags. Managers additionally get every Odoo department so the
 * question builder can opt a new department in.
 */
import { NextResponse } from 'next/server';
import { moduleForbidden } from '@/lib/module-access';
import { fetchDepartments } from '@/lib/shifts-odoo';
import { CAP, actorCan } from '@/lib/closing-report/access';
import { authorize, initClosingTables, jsonError, resolveCompany } from '@/lib/closing-report/route-helpers';
import { departmentIdsWithQuestions, listQuestions, listReportsForDate } from '@/lib/closing-report/db';
import { closingOperationalDate } from '@/lib/closing-report/night';

export async function GET(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  let odooDepts: { id: number; name: string }[];
  try {
    odooDepts = await fetchDepartments(companyId);
  } catch (e) {
    console.error('[closing-report] department fetch failed:', e);
    return jsonError(502, 'Could not load departments right now. Please try again.');
  }
  const nameById = new Map(odooDepts.map((d) => [d.id, d.name]));

  const night = closingOperationalDate();
  const participatingIds = departmentIdsWithQuestions(companyId);
  const reports = listReportsForDate(companyId, night);
  const reportByDept = new Map(reports.map((r) => [r.department_id, r]));

  const departments = participatingIds.map((id) => {
    const r = reportByDept.get(id);
    return {
      id,
      name: nameById.get(id) || `Department ${id}`,
      question_count: listQuestions(companyId, id).length,
      report: r
        ? { id: r.id, submitted_by_name: r.submitted_by_name, submitted_at: r.submitted_at }
        : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const canManage = actorCan(authz.actor, CAP.manage);
  return NextResponse.json({
    date: night,
    company_id: companyId,
    departments,
    can_review: actorCan(authz.actor, CAP.review),
    can_manage: canManage,
    all_departments: canManage ? odooDepts : undefined,
  });
}
