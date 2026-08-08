export const dynamic = 'force-dynamic';
/**
 * GET  /api/closing-report/manage/questions?department_id=  — the builder's list.
 * POST /api/closing-report/manage/questions                 — add a question.
 * Template edits shape FUTURE reports only — submitted reports carry snapshots.
 */
import { NextResponse } from 'next/server';
import { moduleForbidden } from '@/lib/module-access';
import { fetchDepartments } from '@/lib/shifts-odoo';
import { CAP } from '@/lib/closing-report/access';
import { authorize, initClosingTables, jsonError, requestedDepartment, resolveCompany } from '@/lib/closing-report/route-helpers';
import { MAX_QUESTIONS_PER_DEPT, validateQuestionInput } from '@/lib/closing-report/validate';
import { countQuestions, createQuestion, getQuestion, listQuestions } from '@/lib/closing-report/db';

export async function GET(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.manage);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const departmentId = requestedDepartment(request);
  if (!departmentId) return jsonError(400, 'Which department?');
  return NextResponse.json({ questions: listQuestions(companyId, departmentId) });
}

export async function POST(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  let body: { department_id?: unknown; text?: unknown; qtype?: unknown; options?: unknown; problem_values?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'Bad request.'); }
  const departmentId = typeof body.department_id === 'number' ? body.department_id : 0;
  if (!departmentId || departmentId < 1) return jsonError(400, 'Which department?');

  const v = validateQuestionInput(body);
  if (!v.ok) return jsonError(400, v.error);
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
  if (countQuestions(companyId, departmentId) >= MAX_QUESTIONS_PER_DEPT) {
    return jsonError(400, `Keep it short — at most ${MAX_QUESTIONS_PER_DEPT} questions per department.`);
  }
  const id = createQuestion(companyId, departmentId, v);
  return NextResponse.json({ ok: true, question: getQuestion(id) });
}
