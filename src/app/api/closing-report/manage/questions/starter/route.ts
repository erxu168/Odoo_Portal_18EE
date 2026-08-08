export const dynamic = 'force-dynamic';
/**
 * POST /api/closing-report/manage/questions/starter  { department_id }
 * One-tap starter set — only into a department that has never had questions,
 * so it can't clobber a questionnaire someone built.
 */
import { NextResponse } from 'next/server';
import { moduleForbidden } from '@/lib/module-access';
import { fetchDepartments } from '@/lib/shifts-odoo';
import { CAP } from '@/lib/closing-report/access';
import { authorize, initClosingTables, jsonError, resolveCompany } from '@/lib/closing-report/route-helpers';
import { listQuestions, seedStarterQuestions } from '@/lib/closing-report/db';

export async function POST(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  let body: { department_id?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'Bad request.'); }
  const departmentId = typeof body.department_id === 'number' ? body.department_id : 0;
  if (!departmentId || departmentId < 1) return jsonError(400, 'Which department?');
  // Tenant guard: the department must really belong to this restaurant.
  try {
    const depts = await fetchDepartments(companyId);
    if (!depts.some((d) => d.id === departmentId)) {
      return jsonError(400, 'That department does not belong to this restaurant.');
    }
  } catch (e) {
    console.error('[closing-report] department check failed:', e);
    return jsonError(502, 'Could not verify the department right now. Please try again.');
  }
  const seeded = seedStarterQuestions(companyId, departmentId);
  if (!seeded) return jsonError(409, 'This department already has questions.');
  return NextResponse.json({ ok: true, questions: listQuestions(companyId, departmentId) });
}
